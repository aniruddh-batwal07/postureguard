const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionService,
  SessionNotFoundError,
  ActiveSessionExistsError,
  InvalidSessionTransitionError,
} = require('../src/sessions/service');

function inMemoryStore(seed) {
  const sessions = new Map();
  if (seed) sessions.set(seed.sessionId, { ...seed });
  const calls = [];

  return {
    calls,
    async insert(session) {
      sessions.set(session.sessionId, { ...session });
      return session;
    },
    async findBySessionId(sessionId) {
      const s = sessions.get(sessionId);
      return s ? { ...s } : null;
    },
    async findActive() {
      for (const s of sessions.values()) {
        if (s.state !== 'ended') return { ...s };
      }
      return null;
    },
    async updateState(sessionId, changes) {
      calls.push({ sessionId, changes });
      const s = sessions.get(sessionId);
      if (!s) return null;
      Object.assign(s, changes);
      return { ...s };
    },
    async snapshot() {
      return [...sessions.values()].map((s) => ({ ...s }));
    },
  };
}

const fixedNow = () => new Date('2026-03-01T10:00:00.000Z');

test('createSession creates and persists a baseline_capturing session', async () => {
  const store = inMemoryStore();
  const service = createSessionService({ store, now: fixedNow });

  const session = await service.createSession();

  assert.ok(session.sessionId, 'session has an id');
  assert.equal(session.state, 'baseline_capturing');
  assert.equal(session.createdAt.getTime(), fixedNow().getTime());
  assert.equal(session.updatedAt.getTime(), fixedNow().getTime());
  assert.equal(session.endedAt, null);

  const persisted = await store.findBySessionId(session.sessionId);
  assert.ok(persisted, 'session was persisted');
  assert.equal(persisted.state, 'baseline_capturing');
});

test('createSession rejects when a session is already active', async () => {
  const existing = { sessionId: 'a'.repeat(36), state: 'monitoring', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null };
  const store = inMemoryStore(existing);
  const service = createSessionService({ store, now: fixedNow });

  await assert.rejects(service.createSession(), ActiveSessionExistsError);
});

test('getActiveSession returns the active session or null', async () => {
  const active = { sessionId: 'a'.repeat(36), state: 'blocked', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null };
  const store = inMemoryStore(active);
  const service = createSessionService({ store, now: fixedNow });

  assert.equal((await service.getActiveSession()).sessionId, active.sessionId);

  const empty = createSessionService({ store: inMemoryStore(), now: fixedNow });
  assert.equal(await empty.getActiveSession(), null);
});

test('endSession transitions through ending to ended and persists both', async () => {
  const active = { sessionId: 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a', state: 'baseline_capturing', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null };
  const store = inMemoryStore(active);
  const service = createSessionService({ store, now: fixedNow });

  const ended = await service.endSession(active.sessionId);

  assert.equal(ended.state, 'ended');
  assert.equal(ended.endedAt.getTime(), fixedNow().getTime());
  assert.deepEqual(store.calls.map((c) => c.changes.state), ['ending', 'ended']);

  const persisted = await store.findBySessionId(active.sessionId);
  assert.equal(persisted.state, 'ended');
  assert.equal(persisted.endedAt.getTime(), fixedNow().getTime());
});

test('endSession rejects an unknown session', async () => {
  const store = inMemoryStore();
  const service = createSessionService({ store, now: fixedNow });

  await assert.rejects(service.endSession('no-such-session'), SessionNotFoundError);
});

test('endSession rejects an already-ended session', async () => {
  const ended = { sessionId: 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a', state: 'ended', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: new Date('2026-01-01T00:00:00.000Z') };
  const store = inMemoryStore(ended);
  const service = createSessionService({ store, now: fixedNow });

  await assert.rejects(service.endSession(ended.sessionId), InvalidSessionTransitionError);
  assert.equal(store.calls.length, 0);
});

test('markBaselineCaptured transitions baseline_capturing to monitoring and persists it', async () => {
  const capturing = { sessionId: 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a', state: 'baseline_capturing', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null };
  const store = inMemoryStore(capturing);
  const service = createSessionService({ store, now: fixedNow });

  const monitoring = await service.markBaselineCaptured(capturing.sessionId);

  assert.equal(monitoring.state, 'monitoring');
  assert.equal(monitoring.updatedAt.getTime(), fixedNow().getTime());
  assert.deepEqual(store.calls.map((c) => c.changes.state), ['monitoring']);

  const persisted = await store.findBySessionId(capturing.sessionId);
  assert.equal(persisted.state, 'monitoring');
});

test('markBaselineCaptured works without hardware configured', async () => {
  const capturing = { sessionId: 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a', state: 'baseline_capturing', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null };
  const store = inMemoryStore(capturing);
  const service = createSessionService({ store, now: fixedNow });

  const monitoring = await service.markBaselineCaptured(capturing.sessionId);
  assert.equal(monitoring.state, 'monitoring');
});

test('markBaselineCaptured rejects an unknown session', async () => {
  const store = inMemoryStore();
  const service = createSessionService({ store, now: fixedNow });

  await assert.rejects(service.markBaselineCaptured('no-such-session'), SessionNotFoundError);
  assert.equal(store.calls.length, 0);
});

test('markBaselineCaptured rejects a session that is not capturing', async () => {
  for (const state of ['monitoring', 'blocked', 'ending', 'ended']) {
    const sessionDoc = { sessionId: 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a', state, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: state === 'ended' ? new Date('2026-01-01T00:00:00.000Z') : null };
    const store = inMemoryStore(sessionDoc);
    const service = createSessionService({ store, now: fixedNow });

    await assert.rejects(service.markBaselineCaptured(sessionDoc.sessionId), InvalidSessionTransitionError);
    assert.equal(store.calls.length, 0, `no state change for ${state}`);
  }
});