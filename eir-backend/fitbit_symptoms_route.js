// fitbit_symptoms_route.js

const { analyzeFitbitSymptomsForDate } = require("./analyze_fitbit_symptoms");

module.exports = function registerSymptomsRoutes(app, db, requireAuth) {
  app.get("/fitbit/symptoms", requireAuth, async (req, res) => {
    try {
      const uid = req.uid;
      const date = req.query.date || null;

      if (!date) {
        return res.status(400).json({ error: "missing_date_parameter" });
      }

      const docId = `${uid}_${date}`;

      // Always try to fetch raw data (if present)
      const rawDoc = await db.collection("fitbitIntraday").doc(docId).get();
	  
	  console.log("[symptoms] docId:", docId);
	  console.log("[symptoms] rawDoc exists:", rawDoc.exists);


      const raw = rawDoc.exists ? (rawDoc.data()?.data ?? rawDoc.data() ?? null) : null;
	  console.log("[symptoms] raw keys:", raw ? Object.keys(raw) : "NO RAW");

      // 1) Try existing stored indicators first
      const doc = await db.collection("fitbitSymptomIndicators").doc(docId).get();
      if (doc.exists) {
        const data = doc.data() || {};
        return res.json({
          ok: true,
          indicators: data, // same as before
          raw,              // NEW: include raw intraday/day payload
        });
      }

      // 2) Not found -> compute + store
      const computed = await analyzeFitbitSymptomsForDate(db, uid, date);

      if (!computed || !computed.indicators) {
        return res.status(404).json({
          error: "not_found",
          reason: computed?.reason ? computed.reason : "no_indicators",
          raw, // helpful for debugging even on 404
        });
      }

      const newEntry = {
        userId: String(uid),
        date: String(date),
        createdAt: new Date(),
        indicators: computed.indicators,
        sourceDocId: computed.sourceDocId || null,
      };

      await db
        .collection("fitbitSymptomIndicators")
        .doc(docId)
        .set(newEntry, { merge: true });

      console.log("[symptoms] returning payload:", {
		hasIndicators: !!data,
		hasRaw: !!raw,
	  });
	
	console.log("[symptoms] returning computed indicators. response has raw?", !!raw);

      return res.json({
        ok: true,
        indicators: newEntry,
        raw, // NEW
      });
    } catch (err) {
      console.error("fitbit/symptoms error:", err?.message || err);
      return res.status(500).json({ error: "internal_error" });
    }
  });
};
