/**
 * Updated fetch_fitbit_intraday.js
 *
 * This file builds on your existing fetch logic and now:
 * - Attempts intraday fetch, then day fallback (same as previously)
 * - Calls analyzeSymptoms(...) and persists the returned indicators to Firestore
 * - Stores symptom indicators under collection 'fitbitSymptomIndicators' doc id `${uid}_${date}`
 *
 * Replace or merge with your current fetch_fitbit_intraday.js (keep existing error handling).
 */

const admin = require('firebase-admin');
const axios = require('axios');

const db = admin.firestore();

const { analyzeSymptoms } = require('./analyze_fitbit_symptoms');

const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const FITBIT_API_BASE = 'https://api.fitbit.com/1';

async function getConnection(uid) {
  const doc = await db.collection('fitbitConnections').doc(String(uid)).get();
  if (!doc.exists) throw new Error('no_fitbit_connection');
  return { id: doc.id, ...doc.data() };
}

async function refreshAccessToken(uid, refreshToken) {
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('fitbit_client_env_missing');

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString();

  const resp = await axios.post(FITBIT_TOKEN_URL, body, {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 15000,
  });

  const data = resp.data;
  await db.collection('fitbitConnections').doc(String(uid)).set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return data.access_token;
}

async function fetchIntradayForDate(accessToken, fitbitUserId, date) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const hrUrl = `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}/activities/heart/date/${date}/1d/1sec.json`;
  const stepsUrl = `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}/activities/steps/date/${date}/1d/1min.json`;

  const results = {};

  try {
    const hrRes = await axios.get(hrUrl, { headers, timeout: 20000 });
    results.heart = hrRes.data;
  } catch (err) {
    results.heartError = {
      status: err.response?.status || null,
      data: err.response?.data || null,
      message: err.message,
    };
  }

  try {
    const stepsRes = await axios.get(stepsUrl, { headers, timeout: 20000 });
    results.steps = stepsRes.data;
  } catch (err) {
    results.stepsError = {
      status: err.response?.status || null,
      data: err.response?.data || null,
      message: err.message,
    };
  }

  return results;
}

async function fetchDaySummary(accessToken, fitbitUserId, date) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const activityUrl = `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}/activities/date/${date}.json`;
  const sleepUrl = `${FITBIT_API_BASE}/1.2/user/${encodeURIComponent(fitbitUserId)}/sleep/date/${date}.json`;

  const day = {};

  try {
    const activityRes = await axios.get(activityUrl, { headers, timeout: 15000 });
    const activity = activityRes.data;
    day.activity = {
      summary: activity?.summary || null,
      goals: activity?.goals || null,
      raw: activity,
    };
    // copy smart values to top-level summary for convenience
    day.summary = {
      steps: activity?.summary?.steps ?? null,
      calories: activity?.summary?.caloriesOut ?? null,
      restingHeartRate: activity?.summary?.restingHeartRate ?? null,
    };
  } catch (err) {
    day.activityError = {
      status: err.response?.status || null,
      data: err.response?.data || null,
      message: err.message,
    };
  }

  try {
    const sleepRes = await axios.get(sleepUrl, { headers, timeout: 15000 });
    const sleep = sleepRes.data;
    day.sleep = sleep || null;
    if (!day.summary) day.summary = {};
    day.summary.sleepMinutes = sleep?.summary?.totalMinutesAsleep ?? null;
  } catch (err) {
    day.sleepError = {
      status: err.response?.status || null,
      data: err.response?.data || null,
      message: err.message,
    };
  }

  return day;
}

async function fetchForUser(uid, requestedDate) {
  if (!uid) throw new Error('missing_uid');

  const connection = await getConnection(uid);
  let accessToken = connection.accessToken;
  const refreshToken = connection.refreshToken;
  const fitbitUserId = connection.fitbitUserId || '-';

  const date = requestedDate || (new Date()).toISOString().slice(0, 10); // YYYY-MM-DD

  // Try intraday, refresh token on 401 and retry once
  let intradayResult;
  try {
    intradayResult = await fetchIntradayForDate(accessToken, fitbitUserId, date);

    const had401 =
      (intradayResult.heartError && intradayResult.heartError.status === 401) ||
      (intradayResult.stepsError && intradayResult.stepsError.status === 401);

    if (had401 && refreshToken) {
      accessToken = await refreshAccessToken(uid, refreshToken);
      intradayResult = await fetchIntradayForDate(accessToken, fitbitUserId, date);
    }
  } catch (err) {
    intradayResult = { fetchError: { message: err.message || String(err), raw: err.response?.data || null } };
  }

  // Decide if intraday data is usable
  const hasIntraday =
    (intradayResult.heart && Object.keys(intradayResult.heart).length > 0) ||
    (intradayResult.steps && Object.keys(intradayResult.steps).length > 0);

  let dayResult = null;
  if (!hasIntraday) {
    try {
      dayResult = await fetchDaySummary(accessToken, fitbitUserId, date);
    } catch (err) {
      dayResult = { fetchError: { message: err.message || String(err), raw: err.response?.data || null } };
    }
  } else {
    // also fetch day summary to have sleep & activity context
    try {
      dayResult = await fetchDaySummary(accessToken, fitbitUserId, date);
    } catch (err) {
      dayResult = { fetchError: { message: err.message || String(err), raw: err.response?.data || null } };
    }
  }

  // Persist fetched intraday and day into fitbitIntraday
  const docId = `${uid}_${date}`;
  const storedDoc = {
    userId: uid,
    date,
    fitbitUserId,
    data: {
      intraday: intradayResult || null,
      day: dayResult || null,
    },
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('fitbitIntraday').doc(docId).set(storedDoc, { merge: true });

  // Run symptom analysis and persist to fitbitSymptomIndicators
  let analysis = null;
  try {
    analysis = await require('./analyze_fitbit_symptoms').analyzeSymptoms(uid, date, intradayResult || {}, dayResult || {}, db);
    await db.collection('fitbitSymptomIndicators').doc(docId).set({
      userId: uid,
      date,
      indicators: analysis,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // also merge indicators into the fitbitIntraday doc under `analysis`
    await db.collection('fitbitIntraday').doc(docId).set({ analysis }, { merge: true });
  } catch (err) {
    console.error('analysis error', err?.message || err);
  }

  return {
    uid,
    date,
    storedDocId: docId,
    resultSummary: {
      hasIntraday,
      intradayHasHeart: !!(intradayResult && intradayResult.heart),
      intradayHasSteps: !!(intradayResult && intradayResult.steps),
      dayFetched: !!dayResult,
      analysisSummary: {
        // light summary for the client:
        sleepDisruption: analysis?.sleep_disruption ?? null,
        hotFlashCount: Array.isArray(analysis?.hot_flash_events) ? analysis.hot_flash_events.length : 0,
        nightSweats: analysis?.night_sweats ?? null,
        fatigue: analysis?.fatigue_recovery ?? null,
        palpitationsCount: Array.isArray(analysis?.palpitations) ? analysis.palpitations.length : 0,
      },
    },
  };
}

async function handler(req, res) {
  try {
    const userId = (req.query && req.query.userId) || (req.body && req.body.userId) || (req.uid);
    if (!userId) return res.status(400).json({ error: 'missing_userId' });
    const date = (req.body && req.body.date) || (req.query && req.query.date) || null;
    const result = await fetchForUser(userId, date);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('fetch_fitbit_intraday error:', err.response?.data || err.message || err);
    res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = {
  fetchForUser,
  handler,
};