const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { MongoServerSelectionError } = require('mongodb');
const { createApp } = require('../src/app');
const {
  SessionNotFoundError,
  ActiveSessionExistsError,
  InvalidSessionTransitionError,
} = require('../src/sessions/service');
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

function session(overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    state: 'monitoring',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    endedAt: null,
    ...overrides,
  };
}

function fakeService(overrides = {}) {
  return {
    createSession: overrides.createSession || (async () => session({ state: 'baseline_capturing' })),
    getActiveSession: overrides.getActiveSession || (async () => null),
    endSession: overrides.endSession || (async () => session({ state: 'ended', endedAt: new Date('2026-03-01T11:00:00.000Z') })),
  };
}

function app(overrides) {
  return createApp({ persistence: fakePersistence(), sessionService: fakeService(overrides) });
}

test('POST /api/sessions creates a session and returns 201', async () => {
  const res = await request(app()).post('/api/sessions');

  assert.equal(res.status, 201);
  assert.equal(res.body.session.id, SESSION_UUID);
  assert.equal(res.body.session.state, 'baseline_capturing');
  assert.equal(res.body.session.endedAt, null);
  assert.match(res.body.session.createdAt, /2026-03-01T10:00:00/);
});

test('POST /api/sessions maps ActiveSessionExistsError to 409', async () => {
  const res = await request(app({
    createSession: async () => {
      throw new ActiveSessionExistsError('an active session already exists');
    },
  })).post('/api/sessions');

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'an active session already exists');
});

test('GET /api/sessions/active returns the active session', async () => {
  const res = await request(app({
    getActiveSession: async () => session({ state: 'blocked' }),
  })).get('/api/sessions/active');

  assert.equal(res.status, 200);
  assert.equal(res.body.session.id, SESSION_UUID);
  assert.equal(res.body.session.state, 'blocked');
});

test('GET /api/sessions/active returns an empty response when no session is active', async () => {
  const res = await request(app()).get('/api/sessions/active');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { session: null });
});

test('POST /api/sessions/:id/end returns the ended session', async () => {
  const res = await request(app()).post(`/api/sessions/${SESSION_UUID}/end`);

  assert.equal(res.status, 200);
  assert.equal(res.body.session.id, SESSION_UUID);
  assert.equal(res.body.session.state, 'ended');
  assert.match(res.body.session.endedAt, /2026-03-01T11:00:00/);
});

test('POST /api/sessions/:id/end maps SessionNotFoundError to 404', async () => {
  const res = await request(app({
    endSession: async () => {
      throw new SessionNotFoundError('session nope not found');
    },
  })).post(`/api/sessions/${SESSION_UUID}/end`);

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'session nope not found');
});

test('POST /api/sessions/:id/end maps InvalidSessionTransitionError to 409', async () => {
  const res = await request(app({
    endSession: async () => {
      throw new InvalidSessionTransitionError('cannot transition session');
    },
  })).post(`/api/sessions/${SESSION_UUID}/end`);

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'cannot transition session');
});

test('POST /api/sessions/:id/end rejects a malformed session id with 400', async () => {
  const res = await request(app()).post('/api/sessions/not-a-uuid/end');

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid session id');
});

test('session routes map MongoDBUnavailableError to 503', async () => {
  const res = await request(app({
    createSession: async () => {
      throw new MongoDBUnavailableError('MongoDB is not connected');
    },
  })).post('/api/sessions');

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'MongoDB is not connected');
});

test('GET /api/sessions/active maps a live Mongo driver outage to 503', async () => {
  const underlying = new MongoServerSelectionError('connect ECONNREFUSED 127.0.0.1:27017', {
    error: new Error('connect ECONNREFUSED 127.0.0.1:27017'),
  });
  const downPersistence = {
    async status() {
      return { connected: false };
    },
    getDb() {
      return {
        collection() {
          return {
            async findOne() {
              throw underlying;
            },
          };
        },
      };
    },
  };
  const res = await request(createApp({ persistence: downPersistence })).get('/api/sessions/active');

  assert.equal(res.status, 503);
  assert.match(res.body.error, /^MongoDB request failed: connect ECONNREFUSED/);
});