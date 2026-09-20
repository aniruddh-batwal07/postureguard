const { randomUUID } = require('node:crypto');
const { SessionNotFoundError, InvalidSessionTransitionError } = require('../sessions/service');

class SessionNotActiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionNotActiveError';
    this.code = 'SESSION_NOT_ACTIVE';
  }
}

/**
 * Dispatch one recorded event to the session/hardware layer (M4.2).
 *
 * The event is authoritative: it is persisted first and the session POST keeps
 * returning 201 even when the hardware action cannot run. Duplicate events
 * (INVALID_TRANSITION, e.g. a second violation while already blocked) and
 * hardware failures (HARDWARE_* — device unavailable, timeout, protocol error)
 * are logged and swallowed so they never break event ingestion.
 */
function isBenignDispatchError(err) {
  if (err instanceof InvalidSessionTransitionError) {
    return true;
  }
  return Boolean(err.code && typeof err.code === 'string' && err.code.startsWith('HARDWARE_'));
}

function createEventService({
  store,
  findSessionById,
  now = () => new Date(),
  markBaselineCaptured = null,
  blockSession = null,
  retrieveSession = null,
}) {
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
    const persisted = await store.insert(event);

    if (type === 'slouch_violation' && blockSession) {
      try {
        await blockSession(sessionId);
      } catch (err) {
        if (isBenignDispatchError(err)) {
          console.error(`[events] slouch_violation for session ${sessionId} did not trigger hardware: ${err.message}`);
        } else {
          throw err;
        }
      }
    } else if (type === 'correction_requested' && retrieveSession) {
      try {
        await retrieveSession(sessionId);
      } catch (err) {
        if (isBenignDispatchError(err)) {
          console.error(`[events] correction_requested for session ${sessionId} did not trigger hardware: ${err.message}`);
        } else {
          throw err;
        }
      }
    } else if (type === 'baseline_captured' && markBaselineCaptured) {
      try {
        await markBaselineCaptured(sessionId, data);
      } catch (err) {
        if (isBenignDispatchError(err)) {
          console.error(`[events] baseline_captured for session ${sessionId} failed: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
    return persisted;
  }

  async function listEvents(sessionId, { limit = 100 } = {}) {
    const session = await findSessionById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    return store.listBySession(sessionId, { limit });
  }

  return { recordEvent, listEvents };
}

module.exports = { createEventService, SessionNotActiveError };