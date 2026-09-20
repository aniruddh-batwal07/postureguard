const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');

const mongo = require('../src/persistence/mongo');
const { createApp } = require('../src/app');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard_events_test';

let connected = false;

before(async () => {
  try {
    await mongo.connect({ uri: TEST_URI });
    connected = true;
    await mongo.getDb().collection('sessions').deleteMany({});
    await mongo.getDb().collection('events').deleteMany({});
  } catch (err) {
    console.error(`[integration] cannot connect to ${TEST_URI}: ${err.message}`);
  }
});

after(async () => {
  await mongo.disconnect();
});

function testApp() {
  return createApp({ persistence: mongo });
}

function eventsCollection() {
  return mongo.getDb().collection('events');
}

function sessionsCollection() {
  return mongo.getDb().collection('sessions');
}

async function seedSession({ state, sessionId = randomUUID() }) {
  const timestamp = new Date('2026-03-01T09:00:00.000Z');
  await sessionsCollection().insertOne({
    sessionId,
    state,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: state === 'ended' ? timestamp : null,
  });
  return sessionId;
}

function validEvent(sessionId, overrides = {}) {
  return {
    sessionId,
    type: 'slouch_violation',
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

test('POST /api/events persists a valid slouch_violation in MongoDB', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'monitoring' });
  const res = await request(testApp()).post('/api/events').send(validEvent(sessionId));

  assert.equal(res.status, 201);
  assert.equal(res.body.event.sessionId, sessionId);
  assert.equal(res.body.event.type, 'slouch_violation');

  const persisted = await eventsCollection().findOne({ eventId: res.body.event.id });
  assert.ok(persisted, 'event document persisted in MongoDB');
  assert.equal(persisted.sessionId, sessionId);
  assert.equal(persisted.type, 'slouch_violation');
  assert.ok(persisted.createdAt instanceof Date, 'createdAt persisted as a Date');
  assert.ok(persisted.timestamp instanceof Date, 'timestamp persisted as a Date');
});

test('POST /api/events persists a valid correction_requested in MongoDB', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'blocked' });
  const res = await request(testApp()).post('/api/events').send(validEvent(sessionId, {
    type: 'correction_requested',
    data: { reason: 'head_drop' },
  }));

  assert.equal(res.status, 201);
  assert.equal(res.body.event.type, 'correction_requested');
  assert.deepEqual(res.body.event.data, { reason: 'head_drop' });

  const persisted = await eventsCollection().findOne({ eventId: res.body.event.id });
  assert.equal(persisted.type, 'correction_requested');
  assert.deepEqual(persisted.data, { reason: 'head_drop' });
});

test('POST /api/events baseline_captured transitions session baselineState to configured', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'monitoring' });
  const res = await request(testApp()).post('/api/events').send(validEvent(sessionId, {
    type: 'baseline_captured',
    data: { headForward: 0.45, headDrop: 0.15, shoulderRoll: 0.08, sampleCount: 30 },
  }));

  assert.equal(res.status, 201);
  assert.equal(res.body.event.type, 'baseline_captured');

  const session = await sessionsCollection().findOne({ sessionId });
  assert.equal(session.baselineState, 'configured', 'backend moves baselineState to configured');
  assert.equal(session.baseline.headForward, 0.45);
});

test('POST /api/events returns 404 for an unknown session and persists nothing', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const unknownId = randomUUID();
  const before = await eventsCollection().countDocuments();
  const res = await request(testApp()).post('/api/events').send(validEvent(unknownId));

  assert.equal(res.status, 404);
  assert.match(res.body.error, /not found/);
  assert.equal(await eventsCollection().countDocuments(), before, 'no event persisted');
});

test('POST /api/events returns 409 for an ended session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'ended' });
  const res = await request(testApp()).post('/api/events').send(validEvent(sessionId));

  assert.equal(res.status, 409);
  assert.match(res.body.error, /not active/);
});

test('POST /api/events rejects an unsupported event type', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'monitoring' });
  const before = await eventsCollection().countDocuments();
  const res = await request(testApp()).post('/api/events').send(validEvent(sessionId, {
    type: 'suspected_phone',
  }));

  assert.equal(res.status, 400);
  assert.match(res.body.error, /unsupported event type/);
  assert.equal(await eventsCollection().countDocuments(), before, 'no event persisted');
});

test('POST /api/events never creates a session implicitly', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = randomUUID();
  await request(testApp()).post('/api/events').send(validEvent(sessionId));

  const created = await sessionsCollection().findOne({ sessionId });
  assert.equal(created, null, 'event must not create a session');
});

test('GET /api/events returns the persisted events for an active session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'monitoring' });
  await request(testApp()).post('/api/events').send(validEvent(sessionId, { type: 'slouch_violation' }));
  await request(testApp()).post('/api/events').send(validEvent(sessionId, {
    type: 'correction_requested',
    timestamp: '2026-03-01T10:00:05.000Z',
    data: { reason: 'head_drop' },
  }));

  const res = await request(testApp()).get(`/api/events?sessionId=${sessionId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.events.length, 2);
  assert.deepEqual(res.body.events.map((event) => event.type), ['slouch_violation', 'correction_requested']);
  assert.equal(res.body.events[0].sessionId, sessionId);
  assert.ok(res.body.events[0].id, 'event has an id');
  assert.match(res.body.events[0].timestamp, /2026-03-01T10:00:00/);
  assert.deepEqual(res.body.events[1].data, { reason: 'head_drop' });
});

test('GET /api/events is scoped to the requested session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const first = await seedSession({ state: 'monitoring' });
  const second = await seedSession({ state: 'monitoring' });
  await request(testApp()).post('/api/events').send(validEvent(first));
  await request(testApp()).post('/api/events').send(validEvent(second, { type: 'correction_requested' }));

  const res = await request(testApp()).get(`/api/events?sessionId=${first}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.events.length, 1);
  assert.equal(res.body.events[0].sessionId, first);
  assert.equal(res.body.events[0].type, 'slouch_violation');
});

test('GET /api/events returns an empty history for a session with no events', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'baseline_capturing' });

  const res = await request(testApp()).get(`/api/events?sessionId=${sessionId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { events: [] });
});

test('GET /api/events returns 404 for an unknown session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).get(`/api/events?sessionId=${randomUUID()}`);
  assert.equal(res.status, 404);
  assert.match(res.body.error, /not found/);
});

test('GET /api/events returns events for an ended session (history stays viewable)', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'ended' });
  await request(testApp()).post('/api/events').send(validEvent(sessionId)).catch(() => {});

  const otherSessionId = await seedSession({ state: 'ended' });

  const res = await request(testApp()).get(`/api/events?sessionId=${otherSessionId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.events.length, 0);
});