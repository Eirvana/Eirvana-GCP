// Lightweight example Node.js script for Cloud Run that fetches intraday minute HR for connected users
// NOTE: adapt dataset/table names and error handling for production.

const {BigQuery} = require('@google-cloud/bigquery');
const axios = require('axios');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const bigquery = new BigQuery();
const FITBIT_INTRADAY_TABLE = process.env.FITBIT_INTRADAY_TABLE || 'project.dataset.fitbit_minute';

async function refreshFitbitAccessToken(userId, refreshToken) {
  const tokenUrl = "https://api.fitbit.com/oauth2/token";
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  const res = await axios.post(tokenUrl, body, {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  return res.data;
}

async function insertRows(rows) {
  if (!rows.length) return;
  await bigquery.dataset(process.env.BQ_DATASET).table(process.env.BQ_TABLE).insert(rows, { ignoreUnknownValues: true });
}

async function fetchIntradayForDate(accessToken, fitbitUserId, dateIso) {
  // Example for heart rate intraday 1-minute series:
  const url = `https://api.fitbit.com/1/user/${fitbitUserId}/activities/heart/date/${dateIso}/1d/1min.json`;
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  // parse heart rate dataset
  const series = res.data['activities-heart-intraday']?.dataset || [];
  return series.map(pt => ({ timestamp: `${dateIso}T${pt.time}:00Z`, hr: pt.value }));
}

async function processUser(doc) {
  const data = doc.data();
  const userId = doc.id;
  let accessToken = data.accessToken;
  let refreshToken = data.refreshToken;
  const fitbitUserId = data.fitbitUserId || '-';

  const dateIso = (new Date()).toISOString().slice(0,10);
  try {
    const series = await fetchIntradayForDate(accessToken, fitbitUserId, dateIso);
    const rows = series.map(s => ({
      user_id: userId,
      fitbit_user_id: fitbitUserId,
      timestamp: s.timestamp,
      hr: s.hr || null,
      source: 'fitbit',
      ingested_at: new Date().toISOString()
    }));
    await insertRows(rows);
  } catch (err) {
    // try token refresh on 401
    if (err.response && err.response.status === 401 && refreshToken) {
      const refreshed = await refreshFitbitAccessToken(userId, refreshToken);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token || refreshToken;
      // persist refreshed tokens (consider encrypting)
      await db.collection('fitbitConnections').doc(userId).set({
        accessToken,
        refreshToken,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, {merge: true});
      const series = await fetchIntradayForDate(accessToken, fitbitUserId, dateIso);
      const rows = series.map(s => ({
        user_id: userId,
        fitbit_user_id: fitbitUserId,
        timestamp: s.timestamp,
        hr: s.hr || null,
        source: 'fitbit',
        ingested_at: new Date().toISOString()
      }));
      await insertRows(rows);
    } else {
      console.error(`Failed to fetch for user ${userId}:`, err.message || err);
    }
  }
}

exports.handler = async (req, res) => {
  try {
    const snap = await db.collection('fitbitConnections').get();
    const promises = [];
    snap.forEach(doc => {
      promises.push(processUser(doc));
    });
    await Promise.all(promises);
    res.status(200).send('OK');
  } catch (err) {
    console.error('fetch_intraday error', err);
    res.status(500).send('Error');
  }
};