const { randomUUID } = require('node:crypto');
const fsm = require('./fsm');
const { HardwareUnavailableError } = require('../hardware/errors');

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

function formatFriendlySessionName(timestamp) {
  const dateStr = timestamp.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = timestamp.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Session on ${dateStr} at ${timeStr}`;
}

function createSessionService({ store, hardware, now = () => new Date() }) {
  async function createSession({ friendlyName } = {}) {
    const active = await store.findActive();
    if (active) {
      throw new ActiveSessionExistsError('an active session already exists');
    }
    const timestamp = now();
    const name = typeof friendlyName === 'string' && friendlyName.trim().length > 0
      ? friendlyName.trim()
      : formatFriendlySessionName(timestamp);
    const session = {
      sessionId: randomUUID(),
      friendlyName: name,
      state: 'monitoring',
      baselineState: 'unconfigured',
      baseline: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    };
    return store.insert(session);
  }

  async function getActiveSession() {
    return store.findActive();
  }

  async function requestBaselineCapture(sessionId) {
    let session;
    if (sessionId) {
      session = await store.findBySessionId(sessionId);
    } else {
      session = await store.findActive();
    }
    if (!session) {
      throw new SessionNotFoundError('no active session found');
    }
    if (session.state === 'ended') {
      throw new InvalidSessionTransitionError('cannot request baseline capture for an ended session');
    }
    if (session.baselineState === 'capturing') {
      return session;
    }
    return store.updateState(session.sessionId, {
      baselineState: 'capturing',
      updatedAt: now(),
    });
  }

  async function resetBaseline(sessionId) {
    let session;
    if (sessionId) {
      session = await store.findBySessionId(sessionId);
    } else {
      session = await store.findActive();
    }
    if (!session) {
      throw new SessionNotFoundError('no active session found');
    }
    if (session.state === 'ended') {
      throw new InvalidSessionTransitionError('cannot reset baseline for an ended session');
    }
    return store.updateState(session.sessionId, {
      baselineState: 'unconfigured',
      baseline: null,
      updatedAt: now(),
    });
  }

  async function markBaselineCaptured(sessionId, baselineData = null) {
    const session = await store.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    if (session.state === 'ended') {
      throw new InvalidSessionTransitionError(`cannot set baseline for ended session ${sessionId}`);
    }
    const changes = {
      baselineState: 'configured',
      updatedAt: now(),
    };
    if (baselineData !== null && baselineData !== undefined) {
      changes.baseline = baselineData;
    }
    return store.updateState(sessionId, changes);
  }

  async function getHistory({ limit = 20, skip = 0 } = {}) {
    if (store.findHistory) {
      return store.findHistory({ limit, skip });
    }
    return [];
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
    // End-session safety (architecture.md §5.8, ADR-5): if the arm may still be
    // holding the card or moving, return it to the safe docked state before the
    // session closes. Best-effort — a hardware failure never blocks session end.
    // M4.1 makes this the documented "clear path"; M4.2 wires the full flow.
    if (hardware && ['blocking', 'blocked', 'unblocking'].includes(session.state)) {
      try {
        await hardware.retrieve();
      } catch (err) {
        console.error(`[session] final RETRIEVE failed for session ${sessionId}: ${err.message}`);
      }
    }
    const timestamp = now();
    await store.updateState(sessionId, { state: 'ending', updatedAt: timestamp });
    return store.updateState(sessionId, { state: 'ended', updatedAt: timestamp, endedAt: timestamp });
  }

  function requireHardware() {
    if (!hardware) {
      throw new HardwareUnavailableError('hardware transport is not configured for this session service');
    }
  }

  function assertState(session, nextState) {
    if (!fsm.canTransition(session.state, nextState)) {
      throw new InvalidSessionTransitionError(
        `cannot transition session "${session.sessionId}" from "${session.state}" to "${nextState}"`,
      );
    }
  }

  async function blockSession(sessionId) {
    requireHardware();
    const session = await store.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    assertState(session, 'blocking');
    await store.updateState(sessionId, { state: 'blocking', updatedAt: now() });
    try {
      await hardware.block();
    } catch (err) {
      // BLOCK failed: never pretend the screen is blocked. Fall back to
      // monitoring (unless the session has moved on, e.g. ended meanwhile) so
      // a later violation can retry.
      const current = await store.findBySessionId(sessionId);
      if (current && current.state === 'blocking') {
        await store.updateState(sessionId, { state: 'monitoring', updatedAt: now() });
      }
      throw err;
    }
    const current = await store.findBySessionId(sessionId);
    if (current && current.state === 'blocking') {
      return store.updateState(sessionId, { state: 'blocked', updatedAt: now() });
    }
    return current;
  }

  async function retrieveSession(sessionId) {
    requireHardware();
    const session = await store.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    assertState(session, 'unblocking');
    await store.updateState(sessionId, { state: 'unblocking', updatedAt: now() });
    try {
      await hardware.retrieve();
    } catch (err) {
      // RETRIEVE failed: the card is still at the screen; stay blocked rather
      // than falsely reporting monitoring, so a correction can retry.
      const current = await store.findBySessionId(sessionId);
      if (current && current.state === 'unblocking') {
        await store.updateState(sessionId, { state: 'blocked', updatedAt: now() });
      }
      throw err;
    }
    const current = await store.findBySessionId(sessionId);
    if (current && current.state === 'unblocking') {
      return store.updateState(sessionId, { state: 'monitoring', updatedAt: now() });
    }
    return current;
  }

  return {
    createSession,
    getActiveSession,
    requestBaselineCapture,
    resetBaseline,
    markBaselineCaptured,
    getHistory,
    endSession,
    blockSession,
    retrieveSession,
  };
}

module.exports = {
  createSessionService,
  SessionNotFoundError,
  ActiveSessionExistsError,
  InvalidSessionTransitionError,
};