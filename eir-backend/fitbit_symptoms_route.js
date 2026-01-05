/**
 * Helper route module to register symptom routes in your index.js
 *
 * Usage in index.js:
 *   const registerSymptomsRoutes = require('./fitbit_symptoms_route');
 *   registerSymptomsRoutes(app, db, requireAuth);
 *
 * Provides:
 * - GET /fitbit/symptoms?date=YYYY-MM-DD   (requires requireAuth)
 *    returns the stored indicators for the authenticated user for that date (or most recent)
 */
const { analyzeFitbitSymptomsForDate } = require("./analyze_fitbit_symptoms");

module.exports = function registerSymptomsRoutes(app, db, requireAuth) {
  app.get('/fitbit/symptoms', requireAuth, async (req, res) => {
    try {
      const uid = req.uid;
      const date = req.query.date || null;
      if (date) {
	  const docId = `${uid}_${date}`;

	  // 1) Try existing stored indicators first
	  const doc = await db.collection("fitbitSymptomIndicators").doc(docId).get();
	  if (doc.exists) {
		return res.json({ ok: true, indicators: doc.data() });
	  }

	  // 2) Not found -> compute from fitbitIntraday and store indicators
	  const computed = await analyzeFitbitSymptomsForDate(db, uid, date);

	  if (!computed?.indicators) {
		return res.status(404).json({
		  error: "not_found",
		  reason: computed?.reason || "no_indicators",
		});
	  }

	  // Store into the same collection this route already uses
	  await db.collection("fitbitSymptomIndicators").doc(docId).set(
		{
		  userId: String(uid),
		  date: String(date),
		  ...computed.indicators,
		  generatedAt: new Date().toISOString(),
		  sourceDocId: computed.sourceDocId || null,
		},
		{ merge: true }
	  );

  return res.json({
  ok: true,
  indicators: doc.data()?.indicators || doc.data(),
  menopauseSummary: doc.data()?.indicators?.menopauseSummary || null
});


    } catch (err) {
      console.error('fitbit/symptoms error:', err?.message || err);
      res.status(500).json({ error: 'internal_error' });
    }
  });
};