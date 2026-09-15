const express = require('express');
const { validateEvent, SESSION_ID_PATTERN } = require('../validation/event');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function toApiEvent(event) {
  const api = {
    id: event.eventId,
    sessionId: event.sessionId,
    type: event.type,
    timestamp: event.timestamp,
  };
  if (event.data !== undefined) {
    api.data = event.data;
  }
  return api;
}

function parseLimit(rawLimit) {
  if (rawLimit === undefined) {
    return { ok: true, value: DEFAULT_LIMIT };
  }
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)) {
    return { ok: false, error: 'limit must be a positive integer' };
  }
  const parsed = Math.min(Number(rawLimit), MAX_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { ok: false, error: 'limit must be a positive integer' };
  }
  return { ok: true, value: parsed };
}

function createEventsRouter(service) {
  const router = express.Router();

  router.post('/events', async (req, res, next) => {
    const result = validateEvent(req.body);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    try {
      const event = await service.recordEvent(result.value);
      res.status(201).json({ event: toApiEvent(event) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/events', async (req, res, next) => {
    const { sessionId } = req.query;
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId query parameter must be a valid UUID' });
    }

    const limit = parseLimit(req.query.limit);
    if (!limit.ok) {
      return res.status(400).json({ error: limit.error });
    }

    try {
      const events = await service.listEvents(sessionId, { limit: limit.value });
      res.json({ events: events.map(toApiEvent) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createEventsRouter;