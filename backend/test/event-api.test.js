const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { MongoServerSelectionError } = require('mongodb');
const { createApp } = require('../src/app');
const { SessionNotFoundError } = require('../src/sessions/service');
const { SessionNotActiveError } = require('../src/events/service');
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

function event(overrides = {}) {
  return {
    eventId: 'c8c1f3a0-0000-4000-8000-000000000001',
    sessionId: SESSION_UUID,
    type: 'slouch_violation',
    timestamp: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  };
}

function fakeEventService(overrides = {}) {
  return {
    recordEvent: overrides.recordEvent || (async () => event()),
  };
}

function app(overrides = {}) {
  return createApp({
    persistence: fakePersistence(),
    sessionService: { createSession: async () => null, getActiveSession: async () => null, endSession: async () => null },
    eventService: fakeEventService(overrides),
  });
}

function validBody(overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    type: 'slouch_violation',
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

test('POST /api/events accepts a valid slouch_violation and returns 201', async () => {
  const res = await request(app()).post('/api/events').send(validBody());

  assert.equal(res.status, 201);
  assert.equal(res.body.event.id, 'c8c1f3a0-0000-4000-8000-000000000001');
  assert.equal(res.body.event.sessionId, SESSION_UUID);
  assert.equal(res.body.event.type, 'slouch_violation');
  assert.match(res.body.event.timestamp, /2026-03-01T10:00:00/);
});

test('POST /api/events accepts a valid correction_requested with data and returns 201', async () => {
  const res = await request(app({
    recordEvent: async () => event({ type: 'correction_requested', data: { reason: 'head_drop' } }),
  })).post('/api/events').send(validBody({
    type: 'correction_requested',
    data: { reason: 'head_drop' },
  }));

  assert.equal(res.status, 201);
  assert.equal(res.body.event.type, 'correction_requested');
  assert.deepEqual(res.body.event.data, { reason: 'head_drop' });
});

test('POST /api/events rejects a malformed payload with 400', async () => {
  const res = await request(app()).post('/api/events').send({});

  assert.equal(res.status, 400);
  assert.match(res.body.error, /sessionId/);
});

test('POST /api/events rejects an unsupported event type with 400', async () => {
  const res = await request(app()).post('/api/events').send(validBody({ type: 'suspected_phone' }));

  assert.equal(res.status, 400);
  assert.match(res.body.error, /unsupported event type/);
});

test('POST /api/events rejects unknown top-level keys with 400', async () => {
  const res = await request(app()).post('/api/events').send(validBody({ extra: true }));

  assert.equal(res.status, 400);
  assert.match(res.body.error, /unexpected key/);
});

test('POST /api/events rejects malformed JSON with 400', async () => {
  const res = await request(app())
    .post('/api/events')
    .set('Content-Type', 'application/json')
    .send('{"sessionId":');

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid JSON body');
});

test('POST /api/events maps SessionNotFoundError to 404', async () => {
  const res = await request(app({
    recordEvent: async () => {
      throw new SessionNotFoundError('session nope not found');
    },
  })).post('/api/events').send(validBody());

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'session nope not found');
});

test('POST /api/events maps SessionNotActiveError to 409', async () => {
  const res = await request(app({
    recordEvent: async () => {
      throw new SessionNotActiveError('session nope is not active');
    },
  })).post('/api/events').send(validBody());

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'session nope is not active');
});

test('POST /api/events maps MongoDBUnavailableError to 503', async () => {
  const res = await request(app({
    recordEvent: async () => {
      throw new MongoDBUnavailableError('MongoDB is not connected');
    },
  })).post('/api/events').send(validBody());

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'MongoDB is not connected');
});

test('POST /api/events maps a live Mongo driver outage to 503', async () => {
  const underlying = new MongoServerSelectionError('connect ECONNREFUSED 127.0.0.1:27017', {
    error: new Error('connect ECONNREFUSED 127.0.0.1:27017'),
  });
  const downPersistence = {
    async status() {
      return { connected: false };
    },
    getDb() {
      return {
        collection(name) {
          return {
            async findOne() {
              if (name === 'sessions') {
                return { sessionId: SESSION_UUID, state: 'monitoring' };
              }
              throw underlying;
            },
            async insertOne() {
              throw underlying;
            },
          };
        },
      };
    },
  };
  const res = await request(createApp({ persistence: downPersistence }))
    .post('/api/events')
    .send(validBody());

  assert.equal(res.status, 503);
  assert.match(res.body.error, /^MongoDB request failed: connect ECONNREFUSED/);
});