/**
 * fetch_fitbit_intraday.js
 *
 * - Fetches Fitbit intraday HR + steps (timezone-safe)
 * - Falls back to day summary when intraday unavailable
 * - Runs symptom analysis
 * - Persists results to Firestore
 */

const admin = require('firebase-admin');
const axios = require('axios');

const db = admin.firestore();
const { analyzeSymptoms } = require('./analyze_fitbit_symptoms');

const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const FITBIT_API_BASE = 'https://api.fitbit.com/1';

/* =========================
   Timezone-safe helpers
   ========================= */
function yyyymmddInTimeZone(timeZone, d = new Date()) {
  // en-CA => YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
function safeTimeZone(tz) {
  // If tz is invalid, Intl.DateTimeFormat will throw.
  // Fallback to LA.
  try {
    if (!tz) return 'America/Los_Angeles';
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'America/Los_Angeles';
  }
}

/* =========================
   Fitbit auth helpers
   ========================= */
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

/* =========================
   Fitbit fetchers
   ========================= */
async function fetchIntradayForDate(accessToken, fitbitUserId, date) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const hrUrl =
    `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}` +
    `/activities/heart/date/${date}/${date}/1min.json`;

  const stepsUrl =
    `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}` +
    `/activities/steps/date/${date}/${date}/1min.json`;

  const results = { debug: { hrUrl, stepsUrl } };

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

  const activityUrl =
    `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}/activities/date/${date}.json`;

  const sleepUrl =
    `${FITBIT_API_BASE}/1.2/user/${encodeURIComponent(fitbitUserId)}/sleep/date/${date}.json`;

  const day = {};

  try {
    const activityRes = await axios.get(activityUrl, { headers, timeout: 15000 });
    const a = activityRes.data;
    day.activity = a;
    day.summary = {
      steps: a?.summary?.steps ?? null,
      calories: a?.summary?.caloriesOut ?? null,
      restingHeartRate: a?.summary?.restingHeartRate ?? null,
    };
  } catch (err) {
    day.activityError = err.response?.data || err.message;
  }

  try {
    const sleepRes = await axios.get(sleepUrl, { headers, timeout: 15000 });
    day.sleep = sleepRes.data;
    day.summary = day.summary || {};
    day.summary.sleepMinutes = sleepRes.data?.summary?.totalMinutesAsleep ?? null;
  } catch (err) {
    day.sleepError = err.response?.data || err.message;
  }

  return day;
}

/* =========================
   Main worker
   ========================= */
async function fetchForUser(uid, requestedDate,timeZoneRaw) {
  if (!uid) throw new Error('missing_uid');
   const timeZone = safeTimeZone(timeZoneRaw);
   const todayLocal = yyyymmddInTimeZone(timeZone);
   
   
  const connection = await getConnection(uid);
  let accessToken = connection.accessToken;
  const refreshToken = connection.refreshToken;
  const fitbitUserId = connection.fitbitUserId || '-';

  
  let date = requestedDate || todayLocal;
 if (typeof date === 'string') date = date.slice(0, 10);

  console.log('Fitbit fetch date:', date);
   if (date > todayLocal) {
    console.warn(`Clamping future date ${date} -> ${todayLocal} (tz=${timeZone})`);
    date = todayLocal;
  }

  let intradayResult = await fetchIntradayForDate(accessToken, fitbitUserId, date);

  const had401 =
    intradayResult?.heartError?.status === 401 ||
    intradayResult?.stepsError?.status === 401;

  if (had401 && refreshToken) {
    accessToken = await refreshAccessToken(uid, refreshToken);
    intradayResult = await fetchIntradayForDate(accessToken, fitbitUserId, date);
  }

  const heartCount =
    intradayResult?.heart?.['activities-heart-intraday']?.dataset?.length ?? 0;

  const stepsCount =
    intradayResult?.steps?.['activities-steps-intraday']?.dataset?.length ?? 0;

  const hasIntraday = heartCount > 0 || stepsCount > 0;

  console.log('HR dataset:', heartCount, 'Steps dataset:', stepsCount);

  const dayResult = await fetchDaySummary(accessToken, fitbitUserId, date);

  const docId = `${uid}_${date}`;
  const storedDoc = {
    userId: uid,
    date,
    fitbitUserId,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    data: {
      intraday: intradayResult,
      day: dayResult,
    },
    debug: {
      heartCount,
      stepsCount,
    },
  };

  await db.collection('fitbitIntraday').doc(docId).set(storedDoc, { merge: true });

  let analysis = null;
  try {
    analysis = await analyzeSymptoms(uid, date, intradayResult, dayResult, db);
    await db.collection('fitbitSymptomIndicators').doc(docId).set({
      userId: uid,
      date,
      indicators: analysis,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('fitbitIntraday').doc(docId).set({ analysis }, { merge: true });
  } catch (err) {
    console.error('analysis error:', err);
  }

  return {
    uid,
    date,
    hasIntraday,
    heartCount,
    stepsCount,
    docId,
  };
}

/* =========================
   HTTP handler
   ========================= */
async function handler(req, res) {
  try {
    const userId =
      req.query?.userId ||
      req.body?.userId ||
      req.uid;

    if (!userId) {
      return res.status(400).json({ error: 'missing_userId' });
    }

    const date = req.body?.date || req.query?.date || null;
	 const timeZone = req.body?.timeZone || req.query?.timeZone || null;
    const result = await fetchForUser(userId, date,timeZone);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('fetch_fitbit_intraday error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = {
  fetchForUser,
  handler,
};
