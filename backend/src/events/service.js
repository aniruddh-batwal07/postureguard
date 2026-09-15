const { randomUUID } = require('node:crypto');
const { SessionNotFoundError } = require('../sessions/service');

class SessionNotActiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionNotActiveError';
    this.code = 'SESSION_NOT_ACTIVE';
  }
}

function createEventService({ store, findSessionById, now = () => new Date() }) {
  async function recordEvent({ sessionId, type, timestamp, data }) {
    const session = await findSessionById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    if (session.state === 'ended') {
      throw new SessionNotActiveError(`session ${sessionId} is not active`);
    }

    const event = {
      eventId: randomUUID(),
      sessionId,
      type,
      timestamp,
      createdAt: now(),
    };
    if (data !== undefined) {
      event.data = data;
    }
    return store.insert(event);
  }

  return { recordEvent };
}

module.exports = { createEventService, SessionNotActiveError };