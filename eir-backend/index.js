const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");

// --- Firebase Admin init ---
try {
  admin.initializeApp(); // uses project eirvanamobileapp + (default) DB
} catch (err) {
  console.error("Firebase Admin init error:", err);
}

const db = admin.firestore();

// --- Express app setup ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// TEMP user id until real auth
const DEMO_USER_ID = "demo-user-1";

// Helper to send detailed errors
function sendError(res, err, ctx) {
  console.error(`Error in ${ctx}:`, err);
  res.status(500).json({
    error: err?.message || JSON.stringify(err) || "unknown error",
  });
}

// --- Basic routes ---

// Root check
app.get("/", (req, res) => {
  res.json({ status: "root-ok", project: process.env.GOOGLE_CLOUD_PROJECT });
});

// Health: write a debug doc to Firestore
app.get("/health", async (req, res) => {
  try {
    await db.collection("debug").doc("health-check").set(
      {
        lastHit: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    res.json({ status: "ok", project: process.env.GOOGLE_CLOUD_PROJECT });
  } catch (err) {
    sendError(res, err, "health");
  }
});

// --- Symptom routes ---

// Save today's symptoms
// Save today's symptoms
app.post("/symptoms/today", async (req, res) => {
  try {
    const { date, symptoms, notes, userId: bodyUserId } = req.body;
    if (!date || !symptoms) {
      return res
        .status(400)
        .json({ error: "date and symptoms are required" });
    }

    const userId = bodyUserId || DEMO_USER_ID;
    const docId = `${userId}_${date}`;

    await db.collection("symptomEntries").doc(docId).set({
      userId,
      date,
      symptoms,
      notes: notes || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, "symptoms/today");
  }
});


// Get symptom history
// Get symptom history
app.get("/symptoms", async (req, res) => {
  try {
    const { from, to, userId: queryUserId } = req.query;
    const userId = queryUserId || DEMO_USER_ID;

    let query = db
      .collection("symptomEntries")
      .where("userId", "==", userId)
      .orderBy("date", "desc");

    if (from) query = query.where("date", ">=", from);
    if (to) query = query.where("date", "<=", to);

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    res.json(items);
  } catch (err) {
    sendError(res, err, "symptoms");
  }
});


// --- Fitbit OAuth ---

// Step 1: generate Fitbit authorization URL for a user
app.get("/fitbit/auth-url", (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const clientId = process.env.FITBIT_CLIENT_ID;
  const redirectUri = process.env.FITBIT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res
      .status(500)
      .json({ error: "Fitbit env vars not set on server" });
  }

  const scope = encodeURIComponent("activity heartrate sleep profile");
  const encodedRedirect = encodeURIComponent(redirectUri);

  const url =
    `https://www.fitbit.com/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodedRedirect}` +
    `&scope=${scope}` +
    `&state=${encodeURIComponent(userId)}`; // pass userId via state

  res.json({ url });
});

// Step 2: Fitbit redirects back here with ?code=...&state=userId
app.get("/fitbit/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state; // our internal user id

    if (!code || !userId) {
      return res.status(400).send("Missing code or userId (state).");
    }

    const tokenUrl = "https://api.fitbit.com/oauth2/token";
    const redirectUri = process.env.FITBIT_REDIRECT_URI;
    const clientId = process.env.FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    const basicAuth = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString();

    const tokenRes = await axios.post(tokenUrl, body, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = tokenRes.data;

    // Store tokens in Firestore
    await db.collection("fitbitConnections").doc(userId).set(
      {
        fitbitUserId: data.user_id,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        scope: data.scope,
        tokenType: data.token_type,
        expiresIn: data.expires_in,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.send(
      "Fitbit connected! You can close this window and return to the app."
    );
  } catch (err) {
    console.error("Error in Fitbit callback:", err.response?.data || err);
    res.status(500).send("Error connecting Fitbit.");
  }
});

// Check if a user has connected Fitbit
app.get("/fitbit/status", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const doc = await db.collection("fitbitConnections").doc(String(userId)).get();
    if (!doc.exists) {
      return res.json({ connected: false });
    }

    const data = doc.data();
    res.json({
      connected: true,
      fitbitUserId: data.fitbitUserId || null,
      scope: data.scope || "",
      lastUpdated: data.lastUpdated || null,
    });
  } catch (err) {
    sendError(res, err, "fitbit/status");
  }
});

// --- Helpers to fetch Fitbit data ---

async function getFitbitConnection(userId) {
  const doc = await db.collection("fitbitConnections").doc(String(userId)).get();
  if (!doc.exists) {
    throw new Error("Fitbit is not connected for this user");
  }
  return { id: doc.id, ...doc.data() };
}

async function refreshFitbitAccessToken(userId, refreshToken, existingFitbitUserId) {
  const tokenUrl = "https://api.fitbit.com/oauth2/token";
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  const resp = await axios.post(tokenUrl, body, {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = resp.data;

  await db
    .collection("fitbitConnections")
    .doc(String(userId))
    .set(
      {
        fitbitUserId: data.user_id || existingFitbitUserId || null,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        scope: data.scope,
        tokenType: data.token_type,
        expiresIn: data.expires_in,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return data;
}


async function fetchFitbitDailySummary(userId, targetDate) {
  const connection = await getFitbitConnection(userId);
  let accessToken = connection.accessToken;
  const fitbitUserId = connection.fitbitUserId || "-";

  async function fetchWithToken(token) {
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    const activityUrl = `https://api.fitbit.com/1/user/${fitbitUserId}/activities/date/${targetDate}.json`;
    const sleepUrl = `https://api.fitbit.com/1.2/user/${fitbitUserId}/sleep/date/${targetDate}.json`;

    const [activityRes, sleepRes] = await Promise.all([
      axios.get(activityUrl, { headers }),
      axios.get(sleepUrl, { headers }),
    ]);

    const activity = activityRes.data;
    const sleep = sleepRes.data;

    const steps = activity?.summary?.steps ?? 0;
    const calories = activity?.summary?.caloriesOut ?? 0;
    const sleepMinutes =
      sleep?.summary?.totalMinutesAsleep ??
      (Array.isArray(sleep?.sleep)
        ? sleep.sleep.reduce(
            (sum, s) => sum + (s.minutesAsleep || 0),
            0
          )
        : 0);

    return { date: targetDate, steps, calories, sleepMinutes };
  }

  try {
    return await fetchWithToken(accessToken);
  } catch (err) {
    if (err.response && err.response.status === 401 && connection.refreshToken) {
      const refreshed = await refreshFitbitAccessToken(
        userId,
        connection.refreshToken,
        fitbitUserId
      );
      accessToken = refreshed.access_token;
      return await fetchWithToken(accessToken);
    }
    throw err;
  }
}


// Get today's Fitbit summary (steps, calories, sleep) for a user
// Get today's Fitbit summary using helper
app.get("/fitbit/daily-summary", async (req, res) => {
  try {
    const { userId, date } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const today = new Date();
    const isoDate = today.toISOString().slice(0, 10); // YYYY-MM-DD
    const targetDate = (date && String(date)) || isoDate;

    const summary = await fetchFitbitDailySummary(userId, targetDate);
    res.json(summary);
  } catch (err) {
    sendError(res, err, "fitbit/daily-summary");
  }
});

// Merge Fitbit data with symptoms for a given day
app.get("/dashboard/day", async (req, res) => {
  try {
    const { userId: queryUserId, date } = req.query;
    const userId = queryUserId || DEMO_USER_ID;

    const today = new Date();
    const isoDate = today.toISOString().slice(0, 10);
    const targetDate = (date && String(date)) || isoDate;

    // 1) Load symptom entry for that day
    const docId = `${userId}_${targetDate}`;
    const symptomDoc = await db.collection("symptomEntries").doc(docId).get();
    const symptoms = symptomDoc.exists ? symptomDoc.data() : null;

    // 2) Load Fitbit summary for that day
    let fitbit = null;
    try {
      fitbit = await fetchFitbitDailySummary(userId, targetDate);
    } catch (err) {
      console.error("Error fetching Fitbit summary for dashboard:", err?.message || err);
    }

    // 3) Return merged view
    res.json({
      date: targetDate,
      userId,
      symptoms, // may be null
      fitbit,   // may be null if not connected
    });
  } catch (err) {
    sendError(res, err, "dashboard/day");
  }
});


// --- Start server (required for Cloud Run) ---
const port = process.env.PORT || 8080;
app.listen(port, () =>
  console.log(
    `eir-backend running on ${port} (project=${process.env.GOOGLE_CLOUD_PROJECT})`
  )
);
