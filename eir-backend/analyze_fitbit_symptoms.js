/**
 * analyze_fitbit_symptoms.js
 *
 * Exports analyzeSymptoms(uid, date, intradayData, dayData, db)
 * - intradayData: { heart, steps, heartError, stepsError, ... } (as stored by fetch module)
 * - dayData: activity/sleep day summary (may be null)
 * - db: admin.firestore() instance (used to compute short baseline from stored docs)
 *
 * Returns object:
 * {
 *   sleep_disruption: { flag: boolean, score: number, reason: string },
 *   hot_flash_events: [{ ts, hr, steps, evidence }],
 *   night_sweats: { flag, score, reason },
 *   fatigue_recovery: { flag, score, reason },
 *   palpitations: [{ ts, hr, durationSecs, evidence }],
 *   meta: { baseline: {...} }
 * }
 *
 * Heuristics are intentionally conservative and include evidence to help tune thresholds.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function safeNumber(v, fallback = null) {
  if (typeof v === 'number' && !isNaN(v)) return v;
  return fallback;
}

async function computeBaseline(db, uid, date, lookbackDays = 7) {
  // Query recent fitbitIntraday documents prior to `date` to compute median steps / sleep / restingHR
  // Expect doc ids like `${uid}_${YYYY-MM-DD}`
  try {
    const snap = await db
      .collection('fitbitIntraday')
      .where('userId', '==', String(uid))
      .orderBy('date', 'desc')
      .limit(lookbackDays + 1)
      .get();

    const items = snap.docs
      .map((d) => d.data())
      .filter((x) => x && x.date && x.date !== date)
      .slice(0, lookbackDays);

    const stepsArr = [];
    const sleepArr = [];
    const restingHRArr = [];

    for (const it of items) {
      const day = it.data?.day || null;
      const intraday = it.data?.intraday || null;

      const steps = safeNumber(day?.summary?.steps ?? day?.activity?.summary?.steps);
      if (steps !== null) stepsArr.push(steps);

      const sleepMin =
        safeNumber(day?.summary?.sleepMinutes) ??
        safeNumber(day?.sleep?.summary?.totalMinutesAsleep);
      if (sleepMin !== null) sleepArr.push(sleepMin);

      // resting HR might be in activity summary or be derivable from day or intraday
      const resting = safeNumber(day?.activity?.summary?.restingHeartRate ?? day?.activity?.summary?.restingHeartRate);
      if (resting !== null) restingHRArr.push(resting);
    }

    const median = (arr) => {
      if (!arr.length) return null;
      const s = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    return {
      stepsMedian: median(stepsArr),
      sleepMedian: median(sleepArr),
      restingHRMedian: median(restingHRArr),
      sampleCount: items.length,
    };
  } catch (err) {
    console.warn('computeBaseline error', err?.message || err);
    return { stepsMedian: null, sleepMedian: null, restingHRMedian: null, sampleCount: 0 };
  }
}

function parseIntradayHeartSamples(hrData) {
  // Expect hrData to be Fitbit heart intraday object:
  // hrData: { 'activities-heart-intraday': { dataset: [{time: "HH:MM:SS", value: <bpm>}, ...] } }
  // Or heartData.activities-heart-intraday.dataset depending on API response
  try {
    const key = hrData?.['activities-heart-intraday'] ? 'activities-heart-intraday' : 'activities-heart';
    // prefer intraday dataset if exists
    const intraday = hrData?.['activities-heart-intraday'] ?? hrData?.['activities-heart'] ?? null;
    if (!intraday) return [];
    const dataset = intraday.dataset || intraday?.data || [];
    // dataset entries: { time: "HH:MM:SS", value: 72 } or sometimes { "time": "00:00:00", "value": 72 }
    return dataset.map((p) => {
      let t = p.time || p.dateTime || p.timestamp;
      // Keep time string; timestamp decoding happens elsewhere if needed
      return { time: t, value: safeNumber(p.value, null) };
    }).filter((p) => p.value !== null);
  } catch (err) {
    return [];
  }
}

function parseIntradayStepsSamples(stepsData) {
  try {
    const intraday = stepsData?.['activities-steps-intraday'] ?? stepsData;
    const dataset = intraday?.dataset || intraday?.data || [];
    return dataset.map((p) => ({ time: p.time || p.dateTime, value: safeNumber(p.value, null) })).filter((p) => p.value !== null);
  } catch (err) {
    return [];
  }
}

function findRapidHrSpikes(hrSamples, windowSec = 300, deltaBpm = 20) {
  // Find times where HR increases by >= deltaBpm within windowSec (e.g., 5 minutes)
  // hrSamples: array of {time, value} ordered by time ascending
  const spikes = [];
  for (let i = 0; i < hrSamples.length; i++) {
    const base = hrSamples[i];
    for (let j = i + 1; j < hrSamples.length; j++) {
      // compute approximate seconds difference based on time strings (HH:MM:SS)
      // Here we only work on same-day times, so convert HH:MM:SS to seconds
      const t1 = timeToSec(base.time);
      const t2 = timeToSec(hrSamples[j].time);
      if (t2 - t1 > windowSec) break;
      if (hrSamples[j].value - base.value >= deltaBpm) {
        spikes.push({
          startTime: base.time,
          endTime: hrSamples[j].time,
          startHr: base.value,
          peakHr: hrSamples[j].value,
          delta: hrSamples[j].value - base.value,
          windowSec: t2 - t1,
        });
        break; // record one spike per base
      }
    }
  }
  return spikes;
}

function timeToSec(timeStr) {
  // timeStr "HH:MM:SS"
  if (!timeStr) return 0;
  const parts = ('' + timeStr).split(':').map((s) => parseInt(s, 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Determine sleep period time range from dayData.sleep (if available)
function getSleepPeriod(daySleep) {
  // Fitbit sleep object may have sleep[0].startTime , .endTime ; return start and end as local time strings HH:MM:SS
  try {
    const sleepList = daySleep?.sleep;
    if (Array.isArray(sleepList) && sleepList.length > 0) {
      const seg = sleepList[0];
      // startTime/endTime format: "2026-01-02T23:22:00.000"
      const s = seg.startTime || seg.start;
      const e = seg.endTime || seg.end;
      if (s && e) {
        // return ISO times
        return { start: s, end: e, rawSegment: seg };
      }
    }
  } catch (err) {}
  return null;
}

function inSleepWindow(timeStr, sleepPeriod) {
  // timeStr is "HH:MM:SS" or ISO; sleepPeriod has start/end ISO
  if (!sleepPeriod) return false;
  if ((timeStr || '').length > 8 && (sleepPeriod.start || '').length > 8) {
    // compare full ISO strings
    const t = Date.parse(timeStr);
    const s = Date.parse(sleepPeriod.start);
    const e = Date.parse(sleepPeriod.end);
    return t >= s && t <= e;
  }
  // fallback false
  return false;
}

async function analyzeSymptoms(uid, date, intradayData, dayData, db) {
  // intradayData: { heart, steps, heartError, stepsError }
  // dayData: object with activity and sleep summaries
  const baseline = await computeBaseline(db, uid, date, 14);

  const hrSamples = parseIntradayHeartSamples(intradayData?.heart || {});
  const stepsSamples = parseIntradayStepsSamples(intradayData?.steps || {});

  // compute simple stats
  const hrValues = hrSamples.map((s) => s.value);
  const hrMean = hrValues.length ? mean(hrValues) : null;
  const hrMax = hrValues.length ? Math.max(...hrValues) : null;

  const totalSteps = safeNumber(dayData?.summary?.steps ?? dayData?.activity?.summary?.steps ?? null) ??
    (stepsSamples.length ? stepsSamples.reduce((a, b) => a + (b.value || 0), 0) : null);

  const sleepMinutes = safeNumber(dayData?.summary?.sleepMinutes ?? dayData?.sleep?.summary?.totalMinutesAsleep ?? null);

  // Heuristics
  // 1) Sleep disruption
  let sleep_disruption = { flag: false, score: 0, reason: '' };
  const shortSleepThreshold = 6 * 60; // 6 hours
  const awakenings = safeNumber(dayData?.sleep?.summary?.wakeCount ?? dayData?.sleep?.wakeCount ?? null);
  const sleepEfficiency = safeNumber(dayData?.sleep?.summary?.efficiency ?? null);

  if (sleepMinutes !== null && sleepMinutes < shortSleepThreshold) {
    sleep_disruption.flag = true;
    sleep_disruption.score += 0.6;
    sleep_disruption.reason += `short_sleep (${sleepMinutes}m) `;
  }
  if ( awakenings !== null && awakenings >= 3 ) {
    sleep_disruption.flag = true;
    sleep_disruption.score += 0.3;
    sleep_disruption.reason += `wake_count(${awakenings}) `;
  }
  if ( sleepEfficiency !== null && sleepEfficiency < 80 ) {
    sleep_disruption.flag = true;
    sleep_disruption.score += 0.2;
    sleep_disruption.reason += `efficiency(${sleepEfficiency}) `;
  }

  // Compare to baseline sleep median
  if (baseline.sleepMedian && sleepMinutes !== null) {
    if (sleepMinutes < baseline.sleepMedian * 0.8) {
      sleep_disruption.flag = true;
      sleep_disruption.score += 0.4;
      sleep_disruption.reason += `drop_from_baseline(${baseline.sleepMedian}→${sleepMinutes}) `;
    }
  }

  // cap score
  sleep_disruption.score = Math.min(1, sleep_disruption.score);

  // 2) Hot flashes (event-tagged via HR spikes during low activity or during sleep)
  const spikes = findRapidHrSpikes(hrSamples, 300, 20); // 5min window, 20 bpm
  const hot_flash_events = [];
  for (const s of spikes) {
    // check steps around spike (±5min) to ensure low activity
    const tStartSec = timeToSec(s.startTime);
    const tEndSec = timeToSec(s.endTime);
    const windowBefore = stepsSamples.filter((p) => {
      const t = timeToSec(p.time);
      return t >= (tStartSec - 300) && t <= (tEndSec + 300);
    });
    const windowSteps = windowBefore.reduce((a, b) => a + (b.value || 0), 0);
    if (windowSteps <= 20) {
      hot_flash_events.push({
        startTime: s.startTime,
        endTime: s.endTime,
        startHr: s.startHr,
        peakHr: s.peakHr,
        delta: s.delta,
        windowSec: s.windowSec,
        stepsInWindow: windowSteps,
        evidence: 'hr_spike_low_steps',
      });
    }
  }

  // 3) Night sweats (sleep proxy) — detect elevated HR during sleep period
  let night_sweats = { flag: false, score: 0, reason: '' };
  const sleepPeriod = getSleepPeriod(dayData?.sleep);
  if (sleepPeriod) {
    // gather hr samples that fall in sleep window
    const hrInSleep = hrSamples.filter((p) => inSleepWindow(p.time, sleepPeriod));
    const hrInSleepValues = hrInSleep.map((p) => p.value);
    const sleepHrMean = hrInSleepValues.length ? mean(hrInSleepValues) : null;
    if (sleepHrMean !== null && baseline.restingHRMedian !== null) {
      // if mean sleep hr is elevated > 8 bpm above resting
      if (sleepHrMean - baseline.restingHRMedian >= 8) {
        night_sweats.flag = true;
        night_sweats.score += 0.6;
        night_sweats.reason += `elevated_sleep_hr(${sleepHrMean} vs baseline ${baseline.restingHRMedian}) `;
      }
    }
    // also if many short wake fragments (wakeCount high) + HR spikes in sleep -> night sweats
    if (awakenings !== null && awakenings >= 3 && hrInSleepValues.some((h) => h >= (baseline.restingHRMedian ? baseline.restingHRMedian + 10 : 90))) {
      night_sweats.flag = true;
      night_sweats.score += 0.4;
      night_sweats.reason += 'wake_count_with_hr_spike ';
    }
    night_sweats.score = Math.min(1, night_sweats.score);
  }

  // 4) Fatigue / recovery: detect elevated resting HR vs baseline OR low sleep
  let fatigue_recovery = { flag: false, score: 0, reason: '' };
  const restingHRToday = safeNumber(dayData?.activity?.summary?.restingHeartRate ?? dayData?.activity?.summary?.restingHeartRate ?? null);
  if (restingHRToday !== null && baseline.restingHRMedian !== null) {
    if (restingHRToday - baseline.restingHRMedian >= 5) {
      fatigue_recovery.flag = true;
      fatigue_recovery.score += 0.6;
      fatigue_recovery.reason += `restingHR_up(${restingHRToday} vs ${baseline.restingHRMedian}) `;
    }
  }
  if (sleepMinutes !== null && baseline.sleepMedian !== null) {
    if (sleepMinutes < baseline.sleepMedian * 0.8) {
      fatigue_recovery.flag = true;
      fatigue_recovery.score += 0.4;
      fatigue_recovery.reason += `low_sleep_vs_baseline(${sleepMinutes} vs ${baseline.sleepMedian}) `;
    }
  } else if (sleepMinutes !== null && sleepMinutes < 6 * 60) {
    fatigue_recovery.flag = true;
    fatigue_recovery.score += 0.3;
    fatigue_recovery.reason += `short_sleep(${sleepMinutes}) `;
  }
  fatigue_recovery.score = Math.min(1, fatigue_recovery.score);

  // 5) Palpitations: look for rapid HR episodes at rest (HR > 120 sustained > 30s during low activity)
  const palpitations = [];
  const hrThreshold = 120;
  const minDurationSec = 30;
  // find contiguous runs in hrSamples where hr >= threshold
  let runStart = null, runVals = [];
  for (let i = 0; i < hrSamples.length; i++) {
    const s = hrSamples[i];
    if (s.value >= hrThreshold) {
      if (!runStart) {
        runStart = s;
        runVals = [s];
      } else {
        runVals.push(s);
      }
    } else {
      if (runStart) {
        // compute duration approx from times
        const duration = timeToSec(runVals[runVals.length - 1].time) - timeToSec(runStart.time);
        if (duration >= minDurationSec) {
          // check steps around period (±60s)
          const t1 = timeToSec(runStart.time) - 60;
          const t2 = timeToSec(runVals[runVals.length - 1].time) + 60;
          const stepsInWindow = stepsSamples
            .filter((p) => {
              const t = timeToSec(p.time);
              return t >= t1 && t <= t2;
            })
            .reduce((a, b) => a + (b.value || 0), 0);
          if (stepsInWindow <= 20) {
            palpitations.push({
              startTime: runStart.time,
              endTime: runVals[runVals.length - 1].time,
              durationSec: duration,
              avgHr: Math.round(mean(runVals.map((r) => r.value))),
              stepsInWindow,
              evidence: 'sustained_high_hr_low_steps',
            });
          }
        }
        runStart = null;
        runVals = [];
      }
    }
  }
  // final tail
  if (runStart) {
    const duration = timeToSec(runVals[runVals.length - 1].time) - timeToSec(runStart.time);
    if (duration >= minDurationSec) {
      const stepsInWindow = stepsSamples
        .filter((p) => {
          const t = timeToSec(p.time);
          return t >= timeToSec(runStart.time) - 60 && t <= timeToSec(runVals[runVals.length - 1].time) + 60;
        })
        .reduce((a, b) => a + (b.value || 0), 0);
      if (stepsInWindow <= 20) {
        palpitations.push({
          startTime: runStart.time,
          endTime: runVals[runVals.length - 1].time,
          durationSec: duration,
          avgHr: Math.round(mean(runVals.map((r) => r.value))),
          stepsInWindow,
          evidence: 'sustained_high_hr_low_steps',
        });
      }
    }
  }

  // Compose output
  const out = {
    sleep_disruption,
    hot_flash_events,
    night_sweats,
    fatigue_recovery,
    palpitations,
    meta: {
      baseline,
      hrMean,
      hrMax,
      totalSteps,
      sleepMinutes,
      sampleCounts: {
        hrSamples: hrSamples.length,
        stepsSamples: stepsSamples.length,
      },
    },
  };

  return out;
}

module.exports = { analyzeSymptoms };