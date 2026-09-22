'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  HardwareTimeoutError,
  HardwareDeviceError,
} = require('../src/hardware/errors');
const { createHardwareService } = require('../src/hardware/service');
const {
  createSessionService,
  InvalidSessionTransitionError,
  SessionNotFoundError,
} = require('../src/sessions/service');
const { FakeSerialDevice } = require('./helpers/fake-serial-device');

const SESSION_UUID = 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a';
const fixedNow = () => new Date('2026-03-01T10:00:00.000Z');

function session(state, overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    state,
    createdAt: fixedNow(),
    updatedAt: fixedNow(),
    endedAt: null,
    ...overrides,
  };
}

function inMemoryStore(seed) {
  const sessions = new Map();
  if (seed) sessions.set(seed.sessionId, { ...seed });
  const calls = [];

  return {
    calls,
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

function setup({ state, device } = {}) {
  const store = inMemoryStore(state ? session(state) : null);
  const hardware = createHardwareService({ transport: device, commandTimeoutMs: 100 });
  const sessions = createSessionService({ store, hardware, now: fixedNow });
  return { store, hardware, sessions };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('BLOCK succeeds: monitoring → blocking → blocked', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'monitoring', device });

  const pending = sessions.blockSession(SESSION_UUID);
  await flush();
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocking');
  assert.deepEqual(device.sent, ['BLOCK']);

  device.reply('BLOCK_OK');
  const result = await pending;
  assert.equal(result.state, 'blocked');
  assert.deepEqual(store.calls.map((c) => c.changes.state), ['blocking', 'blocked']);
});

test('RETRIEVE succeeds: blocked → unblocking → monitoring', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'blocked', device });

  const pending = sessions.retrieveSession(SESSION_UUID);
  await flush();
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'unblocking');
  assert.deepEqual(device.sent, ['RETRIEVE']);

  device.reply('RETRIEVE_OK');
  const result = await pending;
  assert.equal(result.state, 'monitoring');
  assert.deepEqual(store.calls.map((c) => c.changes.state), ['unblocking', 'monitoring']);
});

test('failed BLOCK (timeout) does not enter blocked', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'monitoring', device });

  const pending = sessions.blockSession(SESSION_UUID);
  await flush();
  assert.deepEqual(device.sent, ['BLOCK']);

  await assert.rejects(pending, HardwareTimeoutError);
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'monitoring');
  assert.deepEqual(device.sent, ['BLOCK']);
});

test('failed BLOCK (device error) does not enter blocked and surfaces the error', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'monitoring', device });

  const pending = sessions.blockSession(SESSION_UUID);
  await flush();
  device.reply('ERROR_STALL');

  await assert.rejects(pending, (err) => {
    assert.ok(err instanceof HardwareDeviceError);
    assert.equal(err.response, 'ERROR_STALL');
    return true;
  });
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('failed BLOCK (wrong ack) does not enter blocked', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'monitoring', device });

  const pending = sessions.blockSession(SESSION_UUID);
  await flush();
  device.reply('RETRIEVE_OK');

  await assert.rejects(pending);
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'monitoring');
});

test('failed RETRIEVE (timeout) does not falsely enter monitoring', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'blocked', device });

  const pending = sessions.retrieveSession(SESSION_UUID);
  await flush();

  await assert.rejects(pending, HardwareTimeoutError);
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocked', 'card is still at the screen');
  assert.deepEqual(device.sent, ['RETRIEVE']);
});

test('failed RETRIEVE (device error) stays blocked', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'blocked', device });

  const pending = sessions.retrieveSession(SESSION_UUID);
  await flush();
  device.reply('ERROR_SERVO_FAULT');

  await assert.rejects(pending, (err) => {
    assert.ok(err instanceof HardwareDeviceError);
    assert.equal(err.response, 'ERROR_SERVO_FAULT');
    return true;
  });
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocked');
});

test('duplicate BLOCK while already blocked is rejected and sends nothing', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { sessions } = setup({ state: 'blocked', device });

  await assert.rejects(sessions.blockSession(SESSION_UUID), InvalidSessionTransitionError);
  assert.deepEqual(device.sent, []);
});

test('duplicate RETRIEVE while already monitoring is rejected and sends nothing', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { sessions } = setup({ state: 'monitoring', device });

  await assert.rejects(sessions.retrieveSession(SESSION_UUID), InvalidSessionTransitionError);
  assert.deepEqual(device.sent, []);
});

test('concurrent BLOCK while a BLOCK is in flight is rejected without sending a second command', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'monitoring', device });

  const first = sessions.blockSession(SESSION_UUID);
  await flush();
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocking');

  await assert.rejects(sessions.blockSession(SESSION_UUID), InvalidSessionTransitionError);
  await assert.rejects(sessions.retrieveSession(SESSION_UUID), InvalidSessionTransitionError);

  device.reply('BLOCK_OK');
  await first;
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocked');
  assert.deepEqual(device.sent, ['BLOCK'], 'only one BLOCK reached the device');
});

test('blockSession and retrieveSession reject an unknown session', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { sessions } = setup({ device });

  await assert.rejects(sessions.blockSession('no-such-session'), SessionNotFoundError);
  await assert.rejects(sessions.retrieveSession('no-such-session'), SessionNotFoundError);
  assert.deepEqual(device.sent, []);
});

test('end of a blocked session forces a final RETRIEVE so the card returns to dock', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'blocked', device });

  const pending = sessions.endSession(SESSION_UUID);
  await flush();
  assert.deepEqual(device.sent, ['RETRIEVE']);
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocked', 'session waits for the arm');

  device.reply('RETRIEVE_OK');
  const result = await pending;
  assert.equal(result.state, 'ended');
});

test('end of session while a BLOCK is in flight still ends and does not resurrect blocked', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'monitoring', device });

  const blockP = sessions.blockSession(SESSION_UUID);
  await flush();
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'blocking');

  const endP = sessions.endSession(SESSION_UUID);
  await flush();
  assert.deepEqual(device.sent, ['BLOCK'], 'final RETRIEVE is queued behind the in-flight BLOCK');

  device.reply('BLOCK_OK');
  await blockP;
  await flush();
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE'], 'final RETRIEVE runs after BLOCK settles');

  device.reply('RETRIEVE_OK');
  await endP;
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'ended');
});

test('a failed final RETRIEVE never blocks session end', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ state: 'blocked', device });

  const pending = sessions.endSession(SESSION_UUID);
  await flush();
  device.reply('ERROR_STALL');

  const result = await pending;
  assert.equal(result.state, 'ended');
  assert.deepEqual(device.sent, ['RETRIEVE']);
  assert.equal((await store.findBySessionId(SESSION_UUID)).state, 'ended');
});

test('createSession sends HOME to bring arm to base position', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ device });

  const pending = sessions.createSession({ friendlyName: 'Test Homing' });
  await flush();
  assert.deepEqual(device.sent, ['HOME'], 'session creation triggers HOME command');

  device.reply('HOME_OK');
  const result = await pending;
  assert.equal(result.state, 'monitoring');
  assert.equal(result.friendlyName, 'Test Homing');
});

test('createSession still succeeds if hardware homing fails (fail-safe)', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const { store, sessions } = setup({ device });

  const pending = sessions.createSession();
  await flush();
  assert.deepEqual(device.sent, ['HOME']);

  device.reply('ERROR_DEVICE_DISCONNECTED');
  const result = await pending;
  assert.equal(result.state, 'monitoring');
});