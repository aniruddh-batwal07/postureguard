'use strict';

/**
 * M4.2 end-to-end manual loop through the full HTTP app, with no real hardware
 * and no MongoDB: createApp is given an in-memory persistence and a real
 * hardware service talking to the FakeSerialDevice. Two loops are proven:
 *
 *   POST /api/events slouch_violation → exactly one BLOCK → session blocked
 *   POST /api/events correction_requested → exactly one RETRIEVE → monitoring
 *
 * plus the duplicate-event guards and the end-of-session returns-to-dock rule.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { createHardwareService } = require('../src/hardware/service');
const { createInMemoryPersistence } = require('./helpers/in-memory-db');
const { FakeSerialDevice } = require('./helpers/fake-serial-device');

const SESSION_UUID = '17b2de6e-3f1d-4ed7-9a8c-1b2c3d4e5f60';
const timestamp = new Date('2026-03-01T10:00:00.000Z');

async function seedSession(persistence, { state, sessionId = SESSION_UUID } = {}) {
  const startedAt = new Date('2026-03-01T09:00:00.000Z');
  await persistence
    .getDb()
    .collection('sessions')
    .insertOne({
      sessionId,
      state,
      createdAt: startedAt,
      updatedAt: startedAt,
      endedAt: null,
    });
}

function buildApp({ device }) {
  const persistence = createInMemoryPersistence();
  const app = createApp({
    persistence,
    hardware: createHardwareService({ transport: device, commandTimeoutMs: 200 }),
  });
  return { app, persistence };
}

function postEvent(app, type, sessionId = SESSION_UUID, data) {
  const body = { sessionId, type, timestamp };
  if (type === 'baseline_captured' && !data) {
    body.data = { headForward: 0.5, headDrop: 0.2, shoulderRoll: 0.1, sampleCount: 30 };
  } else if (data) {
    body.data = data;
  }
  return request(app)
    .post('/api/events')
    .send(body)
    .expect(201);
}

async function activeSession(app) {
  const res = await request(app).get('/api/sessions/active').expect(200);
  return res.body.session;
}

test('full M4.2 loop: violation blocks, correction unblocks, end returns to dock', async () => {
  const device = new FakeSerialDevice();
  const { app, persistence } = buildApp({ device });
  await seedSession(persistence, { state: 'monitoring' });

  // Violation → exactly one BLOCK → screen blocked.
  const violation = await postEvent(app, 'slouch_violation');
  assert.equal(violation.body.event.type, 'slouch_violation');
  assert.deepEqual(device.sent, ['BLOCK'], 'exactly one BLOCK reaches the arm');
  assert.equal((await activeSession(app)).state, 'blocked');

  // Correction → RETRIEVE → monitoring.
  const correction = await postEvent(app, 'correction_requested');
  assert.equal(correction.body.event.type, 'correction_requested');
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE']);
  assert.equal((await activeSession(app)).state, 'monitoring');

  // End session while monitoring: no extra command needed.
  const end = await request(app).post(`/api/sessions/${SESSION_UUID}/end`).expect(200);
  assert.equal(end.body.session.state, 'ended');
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE'], 'no extra command when ending from monitoring');
  assert.equal(await activeSession(app), null);
});

test('real session flow: create → baseline_captured → monitoring → violation → correction → end', async () => {
  const device = new FakeSerialDevice();
  const { app } = buildApp({ device });

  // Start a session via the API: it begins in monitoring with baselineState unconfigured.
  const created = await request(app).post('/api/sessions').expect(201);
  const sessionId = created.body.session.id;
  assert.equal(created.body.session.state, 'monitoring');
  assert.equal(created.body.session.baselineState, 'unconfigured');
  assert.deepEqual(device.sent, [], 'no hardware command on session start');

  // A successful baseline completion moves baselineState to configured.
  const baseline = await postEvent(app, 'baseline_captured', sessionId);
  assert.equal(baseline.body.event.type, 'baseline_captured');
  const active = await activeSession(app);
  assert.equal(active.state, 'monitoring');
  assert.equal(active.baselineState, 'configured');
  assert.deepEqual(device.sent, [], 'baseline completion never touches the arm');

  // Now the real loop drives the arm: violation blocks, correction unblocks.
  await postEvent(app, 'slouch_violation', sessionId);
  assert.deepEqual(device.sent, ['BLOCK']);
  assert.equal((await activeSession(app)).state, 'blocked');

  await postEvent(app, 'correction_requested', sessionId);
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE']);
  assert.equal((await activeSession(app)).state, 'monitoring');

  // End behavior stays correct.
  const end = await request(app).post(`/api/sessions/${sessionId}/end`).expect(200);
  assert.equal(end.body.session.state, 'ended');
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE']);
  assert.equal(await activeSession(app), null);
});

test('requesting baseline capture updates baselineState to capturing', async () => {
  const device = new FakeSerialDevice();
  const { app } = buildApp({ device });

  const created = await request(app).post('/api/sessions').expect(201);
  const sessionId = created.body.session.id;

  const captureRes = await request(app).post('/api/sessions/active/baseline/capture').expect(200);
  assert.equal(captureRes.body.session.baselineState, 'capturing');
  assert.equal((await activeSession(app)).state, 'monitoring');
});

test('second violation while blocked does not re-BLOCK the arm', async () => {
  const device = new FakeSerialDevice();
  const { app, persistence } = buildApp({ device });
  await seedSession(persistence, { state: 'monitoring' });

  await postEvent(app, 'slouch_violation');
  assert.equal((await activeSession(app)).state, 'blocked');

  const second = await postEvent(app, 'slouch_violation');
  assert.equal(second.status, 201, 'duplicate events are still accepted');
  assert.deepEqual(device.sent, ['BLOCK'], 'no second BLOCK command');
  assert.equal((await activeSession(app)).state, 'blocked');
});

test('ending while blocked issues a final RETRIEVE so the arm is docked (ADR-5)', async () => {
  const device = new FakeSerialDevice();
  const { app, persistence } = buildApp({ device });
  await seedSession(persistence, { state: 'blocked' });

  const end = await request(app).post(`/api/sessions/${SESSION_UUID}/end`).expect(200);
  assert.equal(end.body.session.state, 'ended');
  assert.deepEqual(device.sent, ['RETRIEVE'], 'arm returned to dock before session close');
});

test('hardware failure while blocking: event recorded, session falls back to monitoring', async () => {
  const device = new FakeSerialDevice({ noResponseCommands: ['BLOCK'] });
  const { app, persistence } = buildApp({ device });
  await seedSession(persistence, { state: 'monitoring' });

  const violation = await postEvent(app, 'slouch_violation');
  assert.equal(violation.status, 201, 'event is recorded even when the arm is unreachable');
  assert.deepEqual(device.sent, ['BLOCK']);
  assert.equal((await activeSession(app)).state, 'monitoring',
    'never report blocked when BLOCK did not succeed');
});

test('the recorded M4.2 event stream is queryable', async () => {
  const device = new FakeSerialDevice();
  const { app, persistence } = buildApp({ device });
  await seedSession(persistence, { state: 'monitoring' });

  await postEvent(app, 'slouch_violation');
  await postEvent(app, 'correction_requested');

  const res = await request(app).get(`/api/events?sessionId=${SESSION_UUID}`).expect(200);
  const types = res.body.events.map((event) => event.type);
  assert.deepEqual(types, ['slouch_violation', 'correction_requested']);
});