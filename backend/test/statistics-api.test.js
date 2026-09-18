const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { SessionNotFoundError } = require('../src/sessions/service');
const { MongoDBUnavailableError } = require('../src/persistence/mongo');

const SESSION_UUID = 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a';

function fakePersistence() {
  return {
    async status() {
      return { connected: true };
    },
    getDb() {
      return null;
    },
  };
}

function stats(overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    durationSeconds: 600,
    violationCount: 3,
    correctionCount: 1,
    startedAt: new Date('2026-03-01T09:00:00.000Z'),
    endedAt: null,
    ...overrides,
  };
}

function fakeStatisticsService(overrides = {}) {
  return {
    getStatistics: overrides.getStatistics || (async () => stats()),
  };
}

function app(overrides = {}) {
  return createApp({
    persistence: fakePersistence(),
    sessionService: {
      createSession: async () => null,
      getActiveSession: async () => null,
      endSession: async () => null,
    },
    eventService: {
      recordEvent: async () => null,
      listEvents: async () => [],
    },
    statisticsService: fakeStatisticsService(overrides),
  });
}

test('GET /api/statistics returns statistics for a session', async () => {
  const res = await request(app()).get(`/api/statistics?sessionId=${SESSION_UUID}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.statistics.sessionId, SESSION_UUID);
  assert.equal(res.body.statistics.durationSeconds, 600);
  assert.equal(res.body.statistics.violationCount, 3);
  assert.equal(res.body.statistics.correctionCount, 1);
  assert.equal(res.body.statistics.startedAt, '2026-03-01T09:00:00.000Z');
  assert.equal(res.body.statistics.endedAt, null);
});

test('GET /api/statistics serializes endedAt for an ended session', async () => {
  const res = await request(app({
    getStatistics: async () => stats({ endedAt: new Date('2026-03-01T09:10:00.000Z') }),
  })).get(`/api/statistics?sessionId=${SESSION_UUID}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.statistics.endedAt, '2026-03-01T09:10:00.000Z');
});

test('GET /api/statistics returns zero counts for a session with no events', async () => {
  const res = await request(app({
    getStatistics: async () => stats({ durationSeconds: 0, violationCount: 0, correctionCount: 0 }),
  })).get(`/api/statistics?sessionId=${SESSION_UUID}`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.statistics, {
    sessionId: SESSION_UUID,
    durationSeconds: 0,
    violationCount: 0,
    correctionCount: 0,
    startedAt: '2026-03-01T09:00:00.000Z',
    endedAt: null,
  });
});

test('GET /api/statistics rejects a missing sessionId with 400', async () => {
  const res = await request(app()).get('/api/statistics');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /sessionId/);
});

test('GET /api/statistics rejects a malformed sessionId with 400', async () => {
  const res = await request(app()).get('/api/statistics?sessionId=not-a-uuid');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /sessionId/);
});

test('GET /api/statistics maps SessionNotFoundError to 404', async () => {
  const res = await request(app({
    getStatistics: async () => {
      throw new SessionNotFoundError('session nope not found');
    },
  })).get(`/api/statistics?sessionId=${SESSION_UUID}`);

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'session nope not found');
});

test('GET /api/statistics maps MongoDBUnavailableError to 503', async () => {
  const res = await request(app({
    getStatistics: async () => {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist events');
    },
  })).get(`/api/statistics?sessionId=${SESSION_UUID}`);

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'MongoDB is not connected; cannot persist events');
});