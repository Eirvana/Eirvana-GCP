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

module.exports = function registerSymptomsRoutes(app, db, requireAuth) {
  app.get('/fitbit/symptoms', requireAuth, async (req, res) => {
    try {
      const uid = req.uid;
      const date = req.query.date || null;
      if (date) {
        const docId = `${uid}_${date}`;
        const doc = await db.collection('fitbitSymptomIndicators').doc(docId).get();
        if (!doc.exists) return res.status(404).json({ error: 'not_found' });
        return res.json({ ok: true, indicators: doc.data() });
      } else {
        // find most recent indicator doc for this user
        const snap = await db.collection('fitbitSymptomIndicators')
          .where('userId', '==', String(uid))
          .orderBy('date', 'desc')
          .limit(1)
          .get();
        if (snap.empty) return res.status(404).json({ error: 'not_found' });
        const d = snap.docs[0].data();
        return res.json({ ok: true, indicators: d });
      }
    } catch (err) {
      console.error('fitbit/symptoms error:', err?.message || err);
      res.status(500).json({ error: 'internal_error' });
    }
  });
};