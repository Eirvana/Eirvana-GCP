const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const registerSymptomsRoutes = require('./fitbit_symptoms_route'); 


const PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.PROJECT_ID ||
  process.env.GCP_PROJECT ||
  null;

console.log("Resolved PROJECT:", PROJECT);

// --- Firebase Admin init (idempotent) ---
if (!admin.apps.length) {
  admin.initializeApp(); // uses default credentials on Cloud Run / local service account when set
}
const db = admin.firestore();

// --- Env validation (warn if missing) ---
const requiredEnvs = ["FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET", "FITBIT_REDIRECT_URI"];
requiredEnvs.forEach((k) => {
  if (!process.env[k]) {
    console.warn(`[WARN] environment variable ${k} is not set`);
  }
});

// --- Express app setup ---
const app = express();
app.use(helmet());

// Configure CORS - allow Authorization header and configurable origins
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Use express.json() (body-parser built-in)
app.use(express.json());

// TEMP user id until real auth (only for dev flows)
const DEMO_USER_ID = "demo-user-1";

// Helper to send detailed errors (logs server-side, returns safe message client-side)
function sendError(res, err, ctx) {
  console.error(`Error in ${ctx}:`, err && err.stack ? err.stack : err);
  res.status(500).json({
    error: err?.message || "internal_error",
  });
}

// --- Authentication middleware ---
// Verifies Firebase ID token in Authorization: Bearer <idToken>
// On success sets req.uid and req.authTokenClaims
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.header("authorization") || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: "missing_id_token" });
    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    req.authTokenClaims = decoded;
    return next();
  } catch (err) {
    console.error("requireAuth error:", err && err.message ? err.message : err);
    return res.status(401).json({ error: "invalid_id_token" });
  }
}


registerSymptomsRoutes(app, db, requireAuth);
// --- Basic routes ---

// Root check
app.get("/", (req, res) => {
  res.json({ status: "root-ok", project: PROJECT });
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
    res.json({ status: "ok", project: PROJECT });

  } catch (err) {
    sendError(res, err, "health");
  }
});

// --- Symptom routes (require auth in production) ---

// Save today's symptoms (authenticated)
app.post("/symptoms/today", requireAuth, async (req, res) => {
  try {
    const { date, symptoms, notes, userId: bodyUserId } = req.body;
    if (!date || !symptoms) {
      return res.status(400).json({ error: "date and symptoms are required" });
    }

    // Use authenticated uid as authoritative user id
    const userId = bodyUserId ? String(bodyUserId) : req.uid || DEMO_USER_ID;
    if (req.uid && userId !== req.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

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

// Get symptom history (authenticated)
app.get("/symptoms", requireAuth, async (req, res) => {
  try {
    const { from, to, userId: queryUserId } = req.query;
    const userId = queryUserId ? String(queryUserId) : req.uid || DEMO_USER_ID;
    if (req.uid && userId !== req.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

    let query = db.collection("symptomEntries").where("userId", "==", userId).orderBy("date", "desc");

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

// Step 1: generate Fitbit authorization URL for the authenticated user
// GET /fitbit/auth-url  (requires Authorization header)
app.get("/fitbit/auth-url", requireAuth, (req, res) => {
  const uid = req.uid;
  const clientId = process.env.FITBIT_CLIENT_ID;
  const redirectUri = process.env.FITBIT_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "Fitbit env vars not set" });
  }

  // Scopes - include intraday in production if approved
  const scope = encodeURIComponent("activity heartrate sleep profile");
  const encodedRedirect = encodeURIComponent(redirectUri);

  // state is uid so callback knows which Firestore doc to write
  const url =
    `https://www.fitbit.com/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodedRedirect}` +
    `&scope=${scope}` +
    `&state=${encodeURIComponent(uid)}`;

  res.json({ url });
});

// Step 2: Fitbit redirects back here with ?code=...&state=uid
// This endpoint is called by Fitbit (browser redirect), so it can't be authenticated with Firebase token.
// We rely on state to map to uid that initiated the flow.
app.get("/fitbit/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const uid = String(state || "");

    if (!code || !uid) {
      return res.status(400).send("Missing code or state.");
    }

    // Basic validation that state looks like a uid
    if (typeof uid !== "string" || uid.length < 6) {
      console.warn("Unexpected state uid in callback:", uid);
    }

    const tokenUrl = "https://api.fitbit.com/oauth2/token";
    const redirectUri = process.env.FITBIT_REDIRECT_URI;
    const clientId = process.env.FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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

    // Persist tokens under document id = uid
    // NOTE: Do not log tokens. Persist for server-side fetches only.
    await db
      .collection("fitbitConnections")
      .doc(uid)
      .set(
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

    res.send("Fitbit connected. You can close this window and return to the app.");
  } catch (err) {
    console.error("Error in Fitbit callback:", err.response?.data || err);
    res.status(500).send("Error connecting Fitbit.");
  }
});

// Check if the authenticated user has connected Fitbit
app.get("/fitbit/status", requireAuth, async (req, res) => {
  try {
    const uid = req.uid;
    const doc = await db.collection("fitbitConnections").doc(String(uid)).get();
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
  try {
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
  } catch (err) {
    console.error("refreshFitbitAccessToken error:", err.response?.data || err);
    throw err;
  }
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
        ? sleep.sleep.reduce((sum, s) => sum + (s.minutesAsleep || 0), 0)
        : 0);

    return { date: targetDate, steps, calories, sleepMinutes };
  }

  try {
    return await fetchWithToken(accessToken);
  } catch (err) {
    if (err.response && err.response.status === 401 && connection.refreshToken) {
      const refreshed = await refreshFitbitAccessToken(userId, connection.refreshToken, fitbitUserId);
      accessToken = refreshed.access_token;
      return await fetchWithToken(accessToken);
    }
    throw err;
  }
}

// Get today's Fitbit summary (steps, calories, sleep) for authenticated user
app.get("/fitbit/daily-summary", requireAuth, async (req, res) => {
  try {
    const uid = req.uid;
    const { date } = req.query;

    const today = new Date();
    const isoDate = today.toISOString().slice(0, 10); // YYYY-MM-DD
    const targetDate = (date && String(date)) || isoDate;

    const summary = await fetchFitbitDailySummary(uid, targetDate);
    res.json(summary);
  } catch (err) {
    sendError(res, err, "fitbit/daily-summary");
  }
});

// Merge Fitbit data with symptoms for a given day (authenticated)
app.get("/dashboard/day", requireAuth, async (req, res) => {
  try {
    const uid = req.uid;
    const { date } = req.query;

    const today = new Date();
    const isoDate = today.toISOString().slice(0, 10);
    const targetDate = (date && String(date)) || isoDate;

    // 1) Load symptom entry for that day
    const docId = `${uid}_${targetDate}`;
    const symptomDoc = await db.collection("symptomEntries").doc(docId).get();
    const symptoms = symptomDoc.exists ? symptomDoc.data() : null;

    // 2) Load Fitbit summary for that day
    let fitbit = null;
    try {
      fitbit = await fetchFitbitDailySummary(uid, targetDate);
    } catch (err) {
      console.error("Error fetching Fitbit summary for dashboard:", err?.message || err);
    }

    // 3) Return merged view
    res.json({
      date: targetDate,
      userId: uid,
      symptoms, // may be null
      fitbit, // may be null if not connected
    });
  } catch (err) {
    sendError(res, err, "dashboard/day");
  }
});

// --- Per-user fetch trigger (authenticated) ---
// POST /fitbit/fetch-intraday  -> fetch intraday for authenticated user only
app.post("/fitbit/fetch-intraday", requireAuth, async (req, res) => {
  try {
    const uid = req.uid;

    // pull requested date + timezone from the POST body
    const date = req.body?.date || null;
    const timeZone = req.body?.timeZone || null;

    const fetchHandler = require("./fetch_fitbit_intraday");

    // IMPORTANT: call fetchForUser with (uid, date, timeZone)
    const result = await fetchHandler.fetchForUser(uid, date, timeZone);

    // Return the result to the client (so UI can show docId/date/hasIntraday)
    return res.json({ ok: true, result });
  } catch (err) {
    console.error("fetch-intraday error:", err);
    return res.status(500).json({ error: err?.message || "internal_error" });
  }
});


// --- Start server (required for Cloud Run) ---
const port = process.env.PORT || 8080;
app.listen(port, () =>
  console.log(`eir-backend running on ${port} (project=${process.env.GOOGLE_CLOUD_PROJECT || "local"})`)
);