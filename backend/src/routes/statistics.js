const express = require('express');
const { SESSION_ID_PATTERN } = require('../validation/event');

function toApiStatistics(statistics) {
  return {
    sessionId: statistics.sessionId,
    durationSeconds: statistics.durationSeconds,
    violationCount: statistics.violationCount,
    correctionCount: statistics.correctionCount,
    startedAt: statistics.startedAt instanceof Date ? statistics.startedAt.toISOString() : null,
    endedAt: statistics.endedAt instanceof Date ? statistics.endedAt.toISOString() : null,
  };
}

function createStatisticsRouter(service) {
  const router = express.Router();

  router.get('/statistics', async (req, res, next) => {
    const { sessionId } = req.query;
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId query parameter must be a valid UUID' });
    }
    try {
      const statistics = await service.getStatistics(sessionId);
      res.json({ statistics: toApiStatistics(statistics) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createStatisticsRouter;