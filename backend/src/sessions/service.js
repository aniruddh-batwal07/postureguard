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

function createSessionService({ store, hardware, now = () => new Date() }) {
  async function createSession() {
    const active = await store.findActive();
    if (active) {
      throw new ActiveSessionExistsError('an active session already exists');
    }
    // Session-start safety (v1.3): whichever way the previous session ended —
    // or if the arm was reset/moved — bring it back to the resting home dock
    // before any further actions. Fire-and-forget so session creation never
    // blocks; the hardware FIFO serializes this ahead of any later
    // BLOCK/RETRIEVE, and the firmware acks instantly when already docked.
    if (hardware) {
      hardware.retrieve().catch((err) => {
        console.warn(`[session] startup homing failed: ${err.message}`);
      });
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

  // Baseline capture completion: when CV signals that baseline samples have been
  // captured, the arm returns to base position first, and the backend moves the
  // session from `baseline_capturing` to `monitoring`.
  async function markBaselineCaptured(sessionId) {
    const session = await store.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }
    assertState(session, 'monitoring');
    if (hardware) {
      try {
        await hardware.retrieve();
      } catch (err) {
        console.error(`[session] baseline return to base failed for session ${sessionId}: ${err.message}`);
      }
    }
    return store.updateState(sessionId, { state: 'monitoring', updatedAt: now() });
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
    markBaselineCaptured,
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