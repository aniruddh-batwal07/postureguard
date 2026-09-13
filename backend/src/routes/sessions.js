const express = require('express');

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toApiSession(session) {
  if (!session) return null;
  return {
    id: session.sessionId,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt || null,
  };
}

function createSessionsRouter(service) {
  const router = express.Router();

  router.post('/sessions', async (_req, res, next) => {
    try {
      const session = await service.createSession();
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

  router.post('/sessions/:id/end', async (req, res, next) => {
    const { id } = req.params;
    if (!SESSION_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: 'invalid session id' });
    }
    try {
      const session = await service.endSession(id);
      res.json({ session: toApiSession(session) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createSessionsRouter;