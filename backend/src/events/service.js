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
  async function waitForStateSettle(sessionId, transientState, timeoutMs = 35000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await findSessionById(sessionId);
      if (!s || s.state !== transientState) {
        return s;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return null;
  }

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

    const action = type === 'slouch_violation' ? blockSession
      : type === 'correction_requested' ? retrieveSession
      : type === 'baseline_captured' ? markBaselineCaptured
      : null;
    if (action) {
      try {
        await action(sessionId);
      } catch (err) {
        if (err instanceof InvalidSessionTransitionError) {
          const current = await findSessionById(sessionId);
          if (type === 'correction_requested' && current && current.state === 'blocking' && retrieveSession) {
            await waitForStateSettle(sessionId, 'blocking');
            const settled = await findSessionById(sessionId);
            if (settled && settled.state === 'blocked') {
              try {
                await retrieveSession(sessionId);
              } catch (subErr) {
                if (!isBenignDispatchError(subErr)) throw subErr;
              }
            }
          } else if (type === 'slouch_violation' && current && current.state === 'unblocking' && blockSession) {
            await waitForStateSettle(sessionId, 'unblocking');
            const settled = await findSessionById(sessionId);
            if (settled && settled.state === 'monitoring') {
              try {
                await blockSession(sessionId);
              } catch (subErr) {
                if (!isBenignDispatchError(subErr)) throw subErr;
              }
            }
          } else {
            console.error(`[events] ${type} for session ${sessionId} did not trigger hardware: ${err.message}`);
          }
        } else if (isBenignDispatchError(err)) {
          console.error(`[events] ${type} for session ${sessionId} did not trigger hardware: ${err.message}`);
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