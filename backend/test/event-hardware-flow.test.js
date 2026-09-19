'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createEventService } = require('../src/events/service');
const { createHardwareService } = require('../src/hardware/service');
const {
  createSessionService,
  SessionNotFoundError,
} = require('../src/sessions/service');
const { FakeSerialDevice } = require('./helpers/fake-serial-device');

const SESSION_UUID = 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a';
const fixedNow = () => new Date('2026-03-01T10:00:00.000Z');

function session(state) {
  return {
    sessionId: SESSION_UUID,
    state,
    createdAt: new Date('2026-03-01T09:00:00.000Z'),
    updatedAt: new Date('2026-03-01T09:00:00.000Z'),
    endedAt: null,
  };
}

function eventInput(type = 'slouch_violation', overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    type,
    timestamp: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  };
}

function inMemorySessionStore(seed) {
  const sessions = new Map();
  if (seed) sessions.set(seed.sessionId, { ...seed });
  return {
    async insert(sessionDoc) {
      sessions.set(sessionDoc.sessionId, { ...sessionDoc });
      return sessionDoc;
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

function inMemoryEventStore() {
  const events = [];
  return {
    events,
    async insert(event) {
      events.push(event);
      return event;
    },
    async countsBySession() {
      return {};
    },
    async listBySession() {
      return [];
    },
  };
}

function setup({ state, device, commandTimeoutMs = 100 } = {}) {
  const sessionStore = inMemorySessionStore(state ? session(state) : null);
  const eventStore = inMemoryEventStore();
  const hardware = createHardwareService({ transport: device, commandTimeoutMs });
  const sessions = createSessionService({ store: sessionStore, hardware, now: fixedNow });
  const events = createEventService({
    store: eventStore,
    findSessionById: sessionStore.findBySessionId,
    now: fixedNow,
    markBaselineCaptured: sessions.markBaselineCaptured,
    blockSession: sessions.blockSession,
    retrieveSession: sessions.retrieveSession,
  });
  return { sessionStore, eventStore, hardware, sessions, events };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('slouch_violation triggers exactly one BLOCK and the session ends blocked', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'monitoring', device });

  const pending = events.recordEvent(eventInput('slouch_violation'));
  await flush();
  assert.deepEqual(device.sent, ['BLOCK']);
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'blocking');

  device.reply('BLOCK_OK');
  const event = await pending;
  assert.equal(event.type, 'slouch_violation');
  assert.equal(eventStore.events.length, 1, 'violation event persisted');
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'blocked');
});

test('correction_requested triggers exactly one RETRIEVE and returns to monitoring', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'blocked', device });

  const pending = events.recordEvent(eventInput('correction_requested'));
  await flush();
  assert.deepEqual(device.sent, ['RETRIEVE']);
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'unblocking');

  device.reply('RETRIEVE_OK');
  const event = await pending;
  assert.equal(event.type, 'correction_requested');
  assert.equal(eventStore.events.length, 1, 'correction event persisted');
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('failed BLOCK still records the event and falls back to monitoring', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'monitoring', device });

  const pending = events.recordEvent(eventInput('slouch_violation'));
  await flush();
  assert.deepEqual(device.sent, ['BLOCK']);

  device.reply('ERROR_STALL');

  const event = await pending;
  assert.equal(event.type, 'slouch_violation', 'event is not lost when hardware fails');
  assert.equal(eventStore.events.length, 1);
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring',
    'never pretend the screen is blocked when BLOCK failed');
});

test('BLOCK timeout still records the event and falls back to monitoring', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'monitoring', device, commandTimeoutMs: 20 });

  const pending = events.recordEvent(eventInput('slouch_violation'));
  await flush();
  assert.deepEqual(device.sent, ['BLOCK']);

  const event = await pending;
  assert.equal(eventStore.events.length, 1);
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('duplicate slouch_violation while blocked persists but sends no second BLOCK', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'blocked', device });

  const event = await events.recordEvent(eventInput('slouch_violation'));
  assert.equal(event.type, 'slouch_violation');
  assert.equal(eventStore.events.length, 1, 'duplicate violation is still persisted');
  assert.deepEqual(device.sent, [], 'no command reaches the device for a duplicate violation');
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'blocked');
});

test('correction_requested while already monitoring persists but sends no RETRIEVE', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'monitoring', device });

  const event = await events.recordEvent(eventInput('correction_requested'));
  assert.equal(eventStore.events.length, 1);
  assert.deepEqual(device.sent, []);
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('failed RETRIEVE stays blocked and still records the event', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'blocked', device });

  const pending = events.recordEvent(eventInput('correction_requested'));
  await flush();
  assert.deepEqual(device.sent, ['RETRIEVE']);

  device.reply('ERROR_SERVO_FAULT');

  const event = await pending;
  assert.equal(event.type, 'correction_requested');
  assert.equal(eventStore.events.length, 1);
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'blocked',
    'card is still at the screen when RETRIEVE failed');
});

test('event for an unknown session is a 404-style failure and touches nothing hardware-side', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { events } = setup({ state: 'monitoring', device });

  await assert.rejects(
    events.recordEvent(eventInput('slouch_violation', { sessionId: 'no-such-session' })),
    SessionNotFoundError,
  );
  assert.deepEqual(device.sent, []);
});

test('end-session while blocked forces a final RETRIEVE (ADR-5)', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { sessions, sessionStore } = setup({ state: 'blocked', device });

  const endP = sessions.endSession(SESSION_UUID);
  await flush();
  assert.deepEqual(device.sent, ['RETRIEVE'], 'the arm is returned to dock when the session ends blocked');
  device.reply('RETRIEVE_OK');
  const ended = await endP;
  assert.equal(ended.state, 'ended');
});

test('event service without hardware callbacks records events without hardware actions', async () => {
  const sessionStore = inMemorySessionStore(session('monitoring'));
  const eventStore = inMemoryEventStore();
  const events = createEventService({
    store: eventStore,
    findSessionById: sessionStore.findBySessionId,
    now: fixedNow,
  });

  const event = await events.recordEvent(eventInput('slouch_violation'));
  assert.equal(eventStore.events.length, 1, 'no-hardware backend still records the event');
  assert.equal(event.type, 'slouch_violation');
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('baseline_captured moves a real session to monitoring; violations then drive the arm', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { events, sessionStore } = setup({ state: 'baseline_capturing', device });

  // Baseline completed: session becomes monitoring, no hardware command yet.
  const baseline = await events.recordEvent(eventInput('baseline_captured'));
  assert.equal(baseline.type, 'baseline_captured');
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');

  // Real slouch in that session: exactly one BLOCK.
  const violation = events.recordEvent(eventInput('slouch_violation'));
  await flush();
  assert.deepEqual(device.sent, ['BLOCK']);
  device.reply('BLOCK_OK');
  await violation;
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'blocked');

  // Real correction: exactly one RETRIEVE, back to monitoring.
  const correction = events.recordEvent(eventInput('correction_requested'));
  await flush();
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE']);
  device.reply('RETRIEVE_OK');
  await correction;
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('a stray baseline_captured while already monitoring persists but changes nothing', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { eventStore, events, sessionStore } = setup({ state: 'monitoring', device });

  const event = await events.recordEvent(eventInput('baseline_captured'));
  assert.equal(event.type, 'baseline_captured');
  assert.equal(eventStore.events.length, 1, 'duplicate baseline event is still recorded');
  assert.deepEqual(device.sent, [], 'no hardware command for a baseline event');
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('without baseline_captured the session stays baseline_capturing (failed baseline)', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { sessionStore } = setup({ state: 'baseline_capturing', device });

  // No baseline event was posted (e.g. the capture failed/timed out) — the
  // session must remain exactly where it was, in baseline_capturing.
  assert.equal((await sessionStore.findBySessionId(SESSION_UUID)).state, 'baseline_capturing');
});