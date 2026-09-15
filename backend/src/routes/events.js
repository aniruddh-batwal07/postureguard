const express = require('express');
const { validateEvent } = require('../validation/event');

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

  return router;
}

module.exports = createEventsRouter;