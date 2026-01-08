/**
 * Analyze Fitbit intraday data for menopause-related symptom indicators
 * Outputs both raw indicators + a user-friendly menopauseSummary
 */

// ---------- time helpers ----------
function toSec(hhmmss) {
  const [hh, mm, ss] = String(hhmmss || "0:0:0").split(":").map(Number);
  return (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
}

function isNight(timeStr) {
  // Night window: 10pm–6am (crosses midnight)
  const t = toSec(timeStr);
  return t >= 22 * 3600 || t <= 6 * 3600;
}

// ---------- clustering ----------
function clusterHotFlashes(events, clusterMinutes = 10) {
  const sorted = [...(events || [])]
    .filter(e => e?.startTime)
    .sort((a, b) => toSec(a.startTime) - toSec(b.startTime));

  const clusters = [];
  let lastClusterStartSec = null;

  for (const e of sorted) {
    const sec = toSec(e.startTime);

    if (
      lastClusterStartSec === null ||
      sec - lastClusterStartSec > clusterMinutes * 60
    ) {
      clusters.push({
        startTime: e.startTime,
        endTime: e.endTime || null,
        maxDelta: e.delta || 0,
        peakHr: e.peakHr || null,
      });
      lastClusterStartSec = sec;
    } else {
      // merge with previous cluster
      const last = clusters[clusters.length - 1];
      last.endTime = e.endTime || last.endTime;
      last.maxDelta = Math.max(last.maxDelta, e.delta || 0);
      last.peakHr = Math.max(last.peakHr || 0, e.peakHr || 0);
    }
  }

  return clusters;
}


function median(arr) {
  if (!arr || arr.length === 0) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function addMinutesToTimeStr(hhmmss, minutes) {
  const sec = toSec(hhmmss);
  const sec2 = (sec + minutes * 60 + 24 * 3600) % (24 * 3600);
  const hh = String(Math.floor(sec2 / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec2 % 3600) / 60)).padStart(2, "0");
  const ss = String(sec2 % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function parseIso(isoStr) {
  // Fitbit sleep strings look like "2026-01-05T21:24:00.000"
  // JS Date can parse this as local-time-ish; that's fine for “inSleep” gating.
  // If you later want strict TZ handling, use luxon/dayjs.
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function addMinutesToTimeStr(hhmmss, minutes) {
  const sec = toSec(hhmmss);
  const sec2 = (sec + minutes * 60 + 24 * 3600) % (24 * 3600);
  const hh = String(Math.floor(sec2 / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec2 % 3600) / 60)).padStart(2, "0");
  const ss = String(sec2 % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function parseIso(isoStr) {
  // Fitbit sleep strings look like "2026-01-05T21:24:00.000"
  // JS Date can parse this as local-time-ish; that's fine for “inSleep” gating.
  // If you later want strict TZ handling, use luxon/dayjs.
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

function timeOnDateToDate(dateYYYYMMDD, hhmmss) {
  // local date/time
  return new Date(`${dateYYYYMMDD}T${hhmmss}`);
}

function isInSleepWindow(dateYYYYMMDD, hhmmss, sleepStartIso, sleepEndIso) {
  const start = parseIso(sleepStartIso);
  const end = parseIso(sleepEndIso);
  if (!start || !end) return false;

  // If sleep crosses midnight, a time like 01:00 belongs to the next day.
  // We'll try both “date” and “date-1” and see which lands inside the window.
  const t1 = timeOnDateToDate(dateYYYYMMDD, hhmmss);

  const d = new Date(`${dateYYYYMMDD}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const prevDate = d.toISOString().slice(0, 10);
  const t0 = timeOnDateToDate(prevDate, hhmmss);

  return (t0 >= start && t0 <= end) || (t1 >= start && t1 <= end);
}

/**
 * Detect hot flashes from HR spikes when steps are low.
 *
 * Key idea:
 * - baseline = rolling median HR from previous N minutes where steps are low
 * - start event when HR >= baseline + startDelta AND steps are low
 * - end event when HR drops near baseline OR steps rise
 * - require low steps in the minutes *before* the start (to avoid “exercise starts”)
 */
function detectHotFlashes({
  date,
  hrSeries,
  stepsSeries,
  sleepStartIso = null,
  sleepEndIso = null,
  opts = {},
}) {
  const config = {
    baselineWindowMin: 30,     // rolling baseline window
    lowStepsMax: 2,            // “rest” steps per minute threshold
    preLowStepsMin: 5,         // require low steps for last X minutes before start
    startDeltaBpm: 15,         // HR must exceed baseline by this to start
    endDeltaBpm: 8,            // event ends when HR returns near baseline
    minDurationMin: 2,         // at least this many minutes to count
    maxDurationMin: 20,        // cap runaway events
    cooldownMin: 10,           // don’t start a new event too soon after one ends
    maxStepsDuringEvent: 10,   // total steps during event must stay low
    ...opts,
  };

  const stepsByTime = {};
  for (const s of stepsSeries || []) stepsByTime[s.time] = Number(s.value || 0);

  const events = [];
  let i = 0;
  let lastEventEndIdx = -999999;

  while (i < (hrSeries || []).length) {
    if (i - lastEventEndIdx < config.cooldownMin) {
      i++;
      continue;
    }

    const cur = hrSeries[i];
    if (!cur?.time) {
      i++;
      continue;
    }

    const curSteps = stepsByTime[cur.time] ?? 0;
    if (curSteps > config.lowStepsMax) {
      i++;
      continue;
    }

    // Require low steps for the last preLowStepsMin minutes too (precondition)
    let preOk = true;
    for (let p = 1; p <= config.preLowStepsMin; p++) {
      const prevIdx = i - p;
      if (prevIdx < 0) break;
      const prevTime = hrSeries[prevIdx]?.time;
      if (!prevTime) continue;
      const prevSteps = stepsByTime[prevTime] ?? 0;
      if (prevSteps > config.lowStepsMax) {
        preOk = false;
        break;
      }
    }
    if (!preOk) {
      i++;
      continue;
    }

    // Build rolling baseline from previous baselineWindowMin minutes during low steps
    const baselineSamples = [];
    for (let j = Math.max(0, i - config.baselineWindowMin); j < i; j++) {
      const t = hrSeries[j]?.time;
      if (!t) continue;
      const st = stepsByTime[t] ?? 0;
      if (st <= config.lowStepsMax) baselineSamples.push(Number(hrSeries[j]?.value || 0));
    }
    const baseline = median(baselineSamples);
    if (baseline == null) {
      i++;
      continue;
    }

    const curHr = Number(cur.value || 0);
    if (curHr < baseline + config.startDeltaBpm) {
      i++;
      continue;
    }

    // Start an event; scan forward until it ends
    const startIdx = i;
    const startTime = cur.time;
    const startHr = curHr;

    let peakHr = curHr;
    let peakTime = cur.time;
    let stepsSum = curSteps;

    let endIdx = i;
    for (let k = i + 1; k < hrSeries.length; k++) {
      const pt = hrSeries[k];
      if (!pt?.time) break;

      const hr = Number(pt.value || 0);
      const st = stepsByTime[pt.time] ?? 0;

      stepsSum += st;

      if (hr > peakHr) {
        peakHr = hr;
        peakTime = pt.time;
      }

      const durMin = k - startIdx + 1;

      // stop conditions
      if (st > config.lowStepsMax) {
        endIdx = k - 1;
        break;
      }
      if (stepsSum > config.maxStepsDuringEvent) {
        endIdx = k - 1;
        break;
      }
      if (durMin >= config.minDurationMin && hr <= baseline + config.endDeltaBpm) {
        endIdx = k;
        break;
      }
      if (durMin >= config.maxDurationMin) {
        endIdx = k;
        break;
      }

      endIdx = k;
    }

    const durationMin = endIdx - startIdx + 1;
    if (durationMin >= config.minDurationMin) {
      const endTime = hrSeries[endIdx]?.time ?? addMinutesToTimeStr(startTime, durationMin - 1);

      const inSleep =
        sleepStartIso && sleepEndIso
          ? isInSleepWindow(date, startTime, sleepStartIso, sleepEndIso)
          : false;

      events.push({
        startTime,
        endTime,
        peakTime,
        startHr,
        peakHr,
        baselineHr: baseline,
        deltaBpm: peakHr - baseline,
        stepsInWindow: stepsSum,
        durationMin,
        inSleep,
        evidence: "hr_spike_low_steps_baseline",
      });

      lastEventEndIdx = endIdx;
      i = endIdx + 1; // jump past the event so we don’t double-count
      continue;
    }

    i++;
  }

  return events;
}


function timeOnDateToDate(dateYYYYMMDD, hhmmss) {
  // local date/time
  return new Date(`${dateYYYYMMDD}T${hhmmss}`);
}

function isInSleepWindow(dateYYYYMMDD, hhmmss, sleepStartIso, sleepEndIso) {
  const start = parseIso(sleepStartIso);
  const end = parseIso(sleepEndIso);
  if (!start || !end) return false;

  // If sleep crosses midnight, a time like 01:00 belongs to the next day.
  // We'll try both “date” and “date-1” and see which lands inside the window.
  const t1 = timeOnDateToDate(dateYYYYMMDD, hhmmss);

  const d = new Date(`${dateYYYYMMDD}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const prevDate = d.toISOString().slice(0, 10);
  const t0 = timeOnDateToDate(prevDate, hhmmss);

  return (t0 >= start && t0 <= end) || (t1 >= start && t1 <= end);
}

/**
 * Detect hot flashes from HR spikes when steps are low.
 *
 * Key idea:
 * - baseline = rolling median HR from previous N minutes where steps are low
 * - start event when HR >= baseline + startDelta AND steps are low
 * - end event when HR drops near baseline OR steps rise
 * - require low steps in the minutes *before* the start (to avoid “exercise starts”)
 */
function detectHotFlashes({
  date,
  hrSeries,
  stepsSeries,
  sleepStartIso = null,
  sleepEndIso = null,
  opts = {},
}) {
  const config = {
    baselineWindowMin: 30,     // rolling baseline window
    lowStepsMax: 2,            // “rest” steps per minute threshold
    preLowStepsMin: 5,         // require low steps for last X minutes before start
    startDeltaBpm: 15,         // HR must exceed baseline by this to start
    endDeltaBpm: 8,            // event ends when HR returns near baseline
    minDurationMin: 2,         // at least this many minutes to count
    maxDurationMin: 20,        // cap runaway events
    cooldownMin: 10,           // don’t start a new event too soon after one ends
    maxStepsDuringEvent: 10,   // total steps during event must stay low
    ...opts,
  };

  const stepsByTime = {};
  for (const s of stepsSeries || []) stepsByTime[s.time] = Number(s.value || 0);

  const events = [];
  let i = 0;
  let lastEventEndIdx = -999999;

  while (i < (hrSeries || []).length) {
    if (i - lastEventEndIdx < config.cooldownMin) {
      i++;
      continue;
    }

    const cur = hrSeries[i];
    if (!cur?.time) {
      i++;
      continue;
    }

    const curSteps = stepsByTime[cur.time] ?? 0;
    if (curSteps > config.lowStepsMax) {
      i++;
      continue;
    }

    // Require low steps for the last preLowStepsMin minutes too (precondition)
    let preOk = true;
    for (let p = 1; p <= config.preLowStepsMin; p++) {
      const prevIdx = i - p;
      if (prevIdx < 0) break;
      const prevTime = hrSeries[prevIdx]?.time;
      if (!prevTime) continue;
      const prevSteps = stepsByTime[prevTime] ?? 0;
      if (prevSteps > config.lowStepsMax) {
        preOk = false;
        break;
      }
    }
    if (!preOk) {
      i++;
      continue;
    }

    // Build rolling baseline from previous baselineWindowMin minutes during low steps
    const baselineSamples = [];
    for (let j = Math.max(0, i - config.baselineWindowMin); j < i; j++) {
      const t = hrSeries[j]?.time;
      if (!t) continue;
      const st = stepsByTime[t] ?? 0;
      if (st <= config.lowStepsMax) baselineSamples.push(Number(hrSeries[j]?.value || 0));
    }
    const baseline = median(baselineSamples);
    if (baseline == null) {
      i++;
      continue;
    }

    const curHr = Number(cur.value || 0);
    if (curHr < baseline + config.startDeltaBpm) {
      i++;
      continue;
    }

    // Start an event; scan forward until it ends
    const startIdx = i;
    const startTime = cur.time;
    const startHr = curHr;

    let peakHr = curHr;
    let peakTime = cur.time;
    let stepsSum = curSteps;

    let endIdx = i;
    for (let k = i + 1; k < hrSeries.length; k++) {
      const pt = hrSeries[k];
      if (!pt?.time) break;

      const hr = Number(pt.value || 0);
      const st = stepsByTime[pt.time] ?? 0;

      stepsSum += st;

      if (hr > peakHr) {
        peakHr = hr;
        peakTime = pt.time;
      }

      const durMin = k - startIdx + 1;

      // stop conditions
      if (st > config.lowStepsMax) {
        endIdx = k - 1;
        break;
      }
      if (stepsSum > config.maxStepsDuringEvent) {
        endIdx = k - 1;
        break;
      }
      if (durMin >= config.minDurationMin && hr <= baseline + config.endDeltaBpm) {
        endIdx = k;
        break;
      }
      if (durMin >= config.maxDurationMin) {
        endIdx = k;
        break;
      }

      endIdx = k;
    }

    const durationMin = endIdx - startIdx + 1;
    if (durationMin >= config.minDurationMin) {
      const endTime = hrSeries[endIdx]?.time ?? addMinutesToTimeStr(startTime, durationMin - 1);

      const inSleep =
        sleepStartIso && sleepEndIso
          ? isInSleepWindow(date, startTime, sleepStartIso, sleepEndIso)
          : false;

      events.push({
        startTime,
        endTime,
        peakTime,
        startHr,
        peakHr,
        baselineHr: baseline,
        deltaBpm: peakHr - baseline,
        stepsInWindow: stepsSum,
        durationMin,
        inSleep,
        evidence: "hr_spike_low_steps_baseline",
      });

      lastEventEndIdx = endIdx;
      i = endIdx + 1; // jump past the event so we don’t double-count
      continue;
    }

    i++;
  }

  return events;
}

// ---------- scoring helpers ----------
function severityFromCount(count) {
  if (!count || count <= 0) return "None";
  if (count <= 2) return "Low";
  if (count <= 5) return "Moderate";
  return "High";
}

function score01FromCount(count, denom) {
  const d = denom || 5;
  return Math.max(0, Math.min(1, (count || 0) / d));
}

// ---------- menopause summary ----------
function buildMenopauseSummary(indicators) {
  const events = indicators?.hot_flash_events || [];

  // 1) Deduplicate hot flashes
  const hotFlashClusters = clusterHotFlashes(events, 10);
  const hotFlashesCount = hotFlashClusters.length;

  // 2) Night sweats = night hot-flash clusters
  const nightClusters = hotFlashClusters.filter(c =>
    isNight(c.startTime)
  );
  const nightSweatsCount = nightClusters.length;

  // 3) Sleep disruption = driven by night events (MVP logic)
  const derivedSleepDisruption = score01FromCount(nightSweatsCount, 3);
  const existingSleepDisruption = Number(
    indicators?.sleep_disruption?.score || 0
  );
  const sleepDisruptionScore = Math.max(
    derivedSleepDisruption,
    existingSleepDisruption
  );

  return {
    hotFlashes: {
      count: hotFlashesCount,
      severity: severityFromCount(hotFlashesCount),
      score: score01FromCount(hotFlashesCount, 5),
      sampleTimes: hotFlashClusters
        .slice(0, 3)
        .map(c => `${c.startTime}–${c.endTime || ""}`),
    },
    nightSweats: {
      count: nightSweatsCount,
      severity: severityFromCount(nightSweatsCount),
      score: score01FromCount(nightSweatsCount, 3),
      sampleTimes: nightClusters
        .slice(0, 3)
        .map(c => `${c.startTime}–${c.endTime || ""}`),
    },
    sleepDisruption: {
      severity:
        sleepDisruptionScore >= 0.75
          ? "High"
          : sleepDisruptionScore >= 0.4
          ? "Moderate"
          : sleepDisruptionScore > 0
          ? "Low"
          : "None",
      score: Number(sleepDisruptionScore.toFixed(2)),
      reason:
        nightSweatsCount > 0
          ? `Night hot-flash events detected (${nightSweatsCount})`
          : "",
    },
  };
}

// ---------- MAIN ANALYZER ----------
async function analyzeSymptoms(uid, date, intradayData, dayData, db) {
  const indicators = {
    fatigue_recovery: { flag: false, score: 0, reason: "" },
    night_sweats: { flag: false, score: 0, reason: "" },
    sleep_disruption: { flag: false, score: 0, reason: "" },
    hot_flash_events: [],
    palpitations: [],
    meta: {},
  };

  const hrSeries = intradayData?.["activities-heart-intraday"]?.dataset || [];
  const stepsSeries = intradayData?.["activities-steps-intraday"]?.dataset || [];

  const stepsByTime = {};
  for (const s of stepsSeries) stepsByTime[s.time] = Number(s.value || 0);

  // ---------- hot flash detection (deduped) ----------
  const DELTA_THRESHOLD = 20;     // bpm rise within window
  const WINDOW_SEC = 5 * 60;      // 5 minutes
  const MAX_STEPS_IN_WINDOW = 10; // low movement
  const COOLDOWN_SEC = 10 * 60;   // avoid back-to-back duplicates

  let lastEventEndSec = -1e12;

  for (let i = 0; i < hrSeries.length; i++) {
    const start = hrSeries[i];
    if (!start?.time) continue;

    const startHr = Number(start.value);
    if (!Number.isFinite(startHr)) continue;

    const startSec = toSec(start.time);
    if (startSec < lastEventEndSec + COOLDOWN_SEC) continue;

    let peakHr = startHr;
    let peakTime = start.time;
    let stepsSum = stepsByTime[start.time] || 0;

    let endTime = start.time;
    let endIdx = i;

    for (let j = i + 1; j < hrSeries.length; j++) {
      const cur = hrSeries[j];
      if (!cur?.time) break;

      const curSec = toSec(cur.time);
      if (curSec - startSec > WINDOW_SEC) break;

      const curHr = Number(cur.value);
      if (Number.isFinite(curHr) && curHr > peakHr) {
        peakHr = curHr;
        peakTime = cur.time;
      }

      stepsSum += stepsByTime[cur.time] || 0;
      endTime = cur.time;
      endIdx = j;
    }

    const delta = peakHr - startHr;

    if (delta >= DELTA_THRESHOLD && stepsSum <= MAX_STEPS_IN_WINDOW) {
      indicators.hot_flash_events.push({
        startTime: start.time,
        endTime,
        peakTime,
        startHr,
        peakHr,
        delta,
        stepsInWindow: stepsSum,
        windowSec: toSec(endTime) - startSec,
        evidence: "hr_spike_low_steps",
      });

      // ✅ Jump forward so we don’t double-count the same episode
      lastEventEndSec = toSec(endTime);
      i = endIdx;
    }
  }

  // ---------- palpitations ----------
  for (let i = 0; i < hrSeries.length; i++) {
    const h = hrSeries[i];
    if (!h?.time) continue;

    const hr = Number(h.value);
    const st = stepsByTime[h.time] || 0;

    if (hr >= 120 && st === 0) {
      indicators.palpitations.push({
        startTime: h.time,
        endTime: h.time,
        avgHr: hr,
        durationSec: 60,
        stepsInWindow: 0,
        evidence: "high_hr_low_steps",
      });
    }
  }

  // ---------- meta ----------
  const hrValues = hrSeries.map(h => Number(h.value)).filter(Number.isFinite);

  indicators.meta = {
    totalSteps: dayData?.summary?.steps ?? null,
    sleepMinutes: dayData?.sleepMinutes ?? dayData?.summary?.sleepMinutes ?? null,
    hrMax: hrValues.length ? Math.max(...hrValues) : null,
    hrMean: hrValues.length ? (hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null,
    sampleCounts: {
      hrSamples: hrSeries.length,
      stepsSamples: stepsSeries.length,
    },
  };

  indicators.menopauseSummary = buildMenopauseSummary(indicators);
  return indicators;
}


module.exports = {
  analyzeSymptoms,
};
