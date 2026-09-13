const { randomUUID } = require('node:crypto');
const fsm = require('./fsm');

class SessionNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
  }
}

class ActiveSessionExistsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActiveSessionExistsError';
    this.code = 'ACTIVE_SESSION_EXISTS';
  }
}

class InvalidSessionTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidSessionTransitionError';
    this.code = 'INVALID_TRANSITION';
  }
}

function createSessionService({ store, now = () => new Date() }) {
  async function createSession() {
    const active = await store.findActive();
    if (active) {
      throw new ActiveSessionExistsError('an active session already exists');
    }
    const timestamp = now();
    const session = {
      sessionId: randomUUID(),
      state: 'baseline_capturing',
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    };
    return store.insert(session);
  }

  async function getActiveSession() {
    return store.findActive();
  }

  async function endSession(sessionId) {
    const session = await store.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    if (!fsm.canTransition(session.state, 'ending')) {
      throw new InvalidSessionTransitionError(
        `cannot transition session "${sessionId}" from "${session.state}" to "ending"`,
      );
    }
    const timestamp = now();
    await store.updateState(sessionId, { state: 'ending', updatedAt: timestamp });
    return store.updateState(sessionId, { state: 'ended', updatedAt: timestamp, endedAt: timestamp });
  }

  return { createSession, getActiveSession, endSession };
}

module.exports = {
  createSessionService,
  SessionNotFoundError,
  ActiveSessionExistsError,
  InvalidSessionTransitionError,
};