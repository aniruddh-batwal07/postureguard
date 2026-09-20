'use strict';

/**
 * M5.3 — Real hardware swap integration test.
 * Verifies that the hardware service with serial transport integrates
 * with createApp, that slouch_violation and correction_requested execute
 * the physical protocol lifecycle, and that hardware failure degrades gracefully.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { createHardwareService } = require('../src/hardware/service');
const { createInMemoryPersistence } = require('./helpers/in-memory-db');
const { FakeSerialDevice } = require('./helpers/fake-serial-device');

const SESSION_UUID = '33b2de6e-3f1d-4ed7-9a8c-1b2c3d4e5f99';
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

test('M5.3 hardware swap: slouch_violation triggers BLOCK and correction_requested triggers RETRIEVE', async () => {
  const device = new FakeSerialDevice();
  const persistence = createInMemoryPersistence();
  const hardware = createHardwareService({ transport: device, commandTimeoutMs: 500 });
  const app = createApp({ persistence, hardware });

  await seedSession(persistence, { state: 'monitoring' });

  // 1. Slouch violation drives hardware BLOCK
  const vRes = await request(app)
    .post('/api/events')
    .send({ sessionId: SESSION_UUID, type: 'slouch_violation', timestamp })
    .expect(201);
  assert.equal(vRes.body.event.type, 'slouch_violation');
  assert.deepEqual(device.sent, ['BLOCK']);

  // Session state is now blocked
  const blockedSession = await request(app).get('/api/sessions/active').expect(200);
  assert.equal(blockedSession.body.session.state, 'blocked');

  // 2. Correction requested drives hardware RETRIEVE
  const cRes = await request(app)
    .post('/api/events')
    .send({ sessionId: SESSION_UUID, type: 'correction_requested', timestamp })
    .expect(201);
  assert.equal(cRes.body.event.type, 'correction_requested');
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE']);

  // Session state returns to monitoring
  const monitoringSession = await request(app).get('/api/sessions/active').expect(200);
  assert.equal(monitoringSession.body.session.state, 'monitoring');
});

test('M5.3 hardware swap: hardware error degrades gracefully without breaking event persistence', async () => {
  const device = new FakeSerialDevice();
  device.setError('BLOCK', 'ERROR_SERVO_FAULT');

  const persistence = createInMemoryPersistence();
  const hardware = createHardwareService({ transport: device, commandTimeoutMs: 500 });
  const app = createApp({ persistence, hardware });

  await seedSession(persistence, { state: 'monitoring' });

  // Hardware fails, but event is still recorded with 201
  const res = await request(app)
    .post('/api/events')
    .send({ sessionId: SESSION_UUID, type: 'slouch_violation', timestamp })
    .expect(201);
  assert.equal(res.body.event.type, 'slouch_violation');

  // Session did not get stuck in blocking or blocked; stayed monitoring
  const active = await request(app).get('/api/sessions/active').expect(200);
  assert.equal(active.body.session.state, 'monitoring');
});
