const admin = require('firebase-admin');
const axios = require('axios');

const db = admin.firestore();

const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const FITBIT_API_BASE = 'https://api.fitbit.com/1';

async function getConnection(uid) {
  const doc = await db.collection('fitbitConnections').doc(String(uid)).get();
  if (!doc.exists) throw new Error('no_fitbit_connection');
  return { id: doc.id, ...doc.data() };
}

async function refreshAccessTokenIfNeeded(uid, connection) {
  // If token exists and not obviously expired, return it.
  // We don't have explicit expiry timestamp persisted here, so we attempt request and refresh on 401.
  return connection.accessToken;
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
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };

  // Heart rate intraday (1-sec resolution) — requires intraday access permission from Fitbit
  const hrUrl = `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}/activities/heart/date/${date}/1d/1sec.json`;
  // Steps intraday (1-min resolution)
  const stepsUrl = `${FITBIT_API_BASE}/user/${encodeURIComponent(fitbitUserId)}/activities/steps/date/${date}/1d/1min.json`;

  const results = {};

  // Attempt both, but allow one to fail and return what succeeded.
  try {
    const hrRes = await axios.get(hrUrl, { headers, timeout: 20000 });
    results.heart = hrRes.data;
  } catch (err) {
    // Propagate to caller with structured info
    const status = err.response?.status;
    const data = err.response?.data;
    results.heartError = { status, data, message: err.message };
  }

  try {
    const stepsRes = await axios.get(stepsUrl, { headers, timeout: 20000 });
    results.steps = stepsRes.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    results.stepsError = { status, data, message: err.message };
  }

  return results;
}

async function fetchForUser(uid, requestedDate) {
  if (!uid) throw new Error('missing_uid');

  const connection = await getConnection(uid);
  let accessToken = connection.accessToken;
  const refreshToken = connection.refreshToken;
  const fitbitUserId = connection.fitbitUserId || '-';

  const date = requestedDate || (new Date()).toISOString().slice(0, 10); // YYYY-MM-DD

  // Try fetch; if 401, try refresh + retry once
  let intraday;
  try {
    intraday = await fetchIntradayForDate(accessToken, fitbitUserId, date);

    // Detect 401s from either call
    const had401 =
      (intraday.heartError && intraday.heartError.status === 401) ||
      (intraday.stepsError && intraday.stepsError.status === 401);

    if (had401 && refreshToken) {
      accessToken = await refreshAccessToken(uid, refreshToken);
      intraday = await fetchIntradayForDate(accessToken, fitbitUserId, date);
    }
  } catch (err) {
    // Bubble up for the caller to log
    throw err;
  }

  // Persist fetched intraday data (store both successes and error objects)
  const docId = `${uid}_${date}`;
  await db.collection('fitbitIntraday').doc(docId).set({
    userId: uid,
    date,
    fitbitUserId,
    data: intraday,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { uid, date, storedDocId: docId, resultSummary: {
    hasHeart: !!intraday.heart,
    hasSteps: !!intraday.steps,
    heartError: intraday.heartError || null,
    stepsError: intraday.stepsError || null,
  }};
}

// Express-style handler so index.js can call fetchHandler.handler(req,res)
async function handler(req, res) {
  try {
    const userId = (req.query && req.query.userId) || (req.body && req.body.userId);
    if (!userId) return res.status(400).json({ error: 'missing_userId' });

    const result = await fetchForUser(userId, req.query.date);
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