const express = require('express');

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toApiSession(session) {
  if (!session) return null;
  return {
    id: session.sessionId,
    friendlyName: session.friendlyName || null,
    state: session.state,
    baselineState: session.baselineState || 'unconfigured',
    baseline: session.baseline || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt || null,
  };
}

function createSessionsRouter(service, statisticsService = null, cvManager = null) {
  const router = express.Router();

  router.post('/sessions', async (req, res, next) => {
    try {
      const friendlyName = req.body && typeof req.body.friendlyName === 'string' ? req.body.friendlyName : undefined;
      const baseline = req.body && req.body.baseline && typeof req.body.baseline === 'object' ? req.body.baseline : undefined;
      const session = await service.createSession({ friendlyName, baseline });
      if (cvManager && typeof cvManager.start === 'function') {
        cvManager.start().catch((err) => {
          console.warn(`[cv-manager] auto-start failed: ${err.message}`);
        });
      }
      res.status(201).json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sessions/active', async (_req, res, next) => {
    try {
      const session = await service.getActiveSession();
      res.json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions/active/baseline/capture', async (_req, res, next) => {
    try {
      const active = await service.getActiveSession();
      if (!active) {
        return res.status(404).json({ error: 'no active session' });
      }
      const session = await service.requestBaselineCapture(active.sessionId);
      res.json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions/active/baseline/reset', async (_req, res, next) => {
    try {
      const active = await service.getActiveSession();
      if (!active) {
        return res.status(404).json({ error: 'no active session' });
      }
      const session = await service.resetBaseline(active.sessionId);
      res.json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sessions/history', async (req, res, next) => {
    try {
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 20;
      const skip = req.query.skip !== undefined ? parseInt(req.query.skip, 10) : 0;
      if (Number.isNaN(limit) || limit < 1) {
        return res.status(400).json({ error: 'limit must be a positive integer' });
      }
      if (Number.isNaN(skip) || skip < 0) {
        return res.status(400).json({ error: 'skip must be a non-negative integer' });
      }
      const rawSessions = await service.getHistory({ limit, skip });
      const historySessions = await Promise.all(
        rawSessions.map(async (sess) => {
          const base = toApiSession(sess);
          if (statisticsService) {
            try {
              const stats = await statisticsService.getStatistics(sess.sessionId);
              return {
                ...base,
                durationSeconds: stats.durationSeconds,
                violationCount: stats.violationCount,
                correctionCount: stats.correctionCount,
                violationDurationSeconds: stats.violationDurationSeconds,
              };
            } catch {
              // fallback if statistics fail
            }
          }
          const duration = sess.endedAt && sess.createdAt
            ? Math.round((new Date(sess.endedAt).getTime() - new Date(sess.createdAt).getTime()) / 1000)
            : 0;
          return {
            ...base,
            durationSeconds: duration,
            violationCount: 0,
            correctionCount: 0,
            violationDurationSeconds: 0,
          };
        }),
      );
      res.json({ sessions: historySessions });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions/active/baseline', async (req, res, next) => {
    try {
      const active = await service.getActiveSession();
      if (!active) {
        return res.status(404).json({ error: 'no active session' });
      }
      const baseline = req.body && req.body.baseline ? req.body.baseline : req.body;
      const session = await service.markBaselineCaptured(active.sessionId, baseline);
      res.json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions/:id/end', async (req, res, next) => {
    const { id } = req.params;
    if (!SESSION_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: 'invalid session id' });
    }
    try {
      const session = await service.endSession(id);
      if (cvManager && typeof cvManager.stop === 'function') {
        cvManager.stop().catch((err) => {
          console.warn(`[cv-manager] auto-stop failed: ${err.message}`);
        });
      }
      res.json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createSessionsRouter;