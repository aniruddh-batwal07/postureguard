const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');

const mongo = require('../src/persistence/mongo');
const { createApp } = require('../src/app');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard_stats_test';

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

function sessionsCollection() {
  return mongo.getDb().collection('sessions');
}

function eventsCollection() {
  return mongo.getDb().collection('events');
}

async function seedSession({ state, createdAt, endedAt }) {
  const sessionId = randomUUID();
  await sessionsCollection().insertOne({
    sessionId,
    state,
    createdAt,
    updatedAt: createdAt,
    endedAt: endedAt || null,
  });
  return sessionId;
}

async function seedEvent({ sessionId, type, timestamp }) {
  await eventsCollection().insertOne({
    eventId: randomUUID(),
    sessionId,
    type,
    timestamp,
    createdAt: timestamp,
  });
}

const START = new Date('2026-03-01T09:00:00.000Z');
const END = new Date('2026-03-01T09:10:00.000Z');

test('GET /api/statistics aggregates counts and duration for an ended session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'ended', createdAt: START, endedAt: END });
  await seedEvent({ sessionId, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:01:00.000Z') });
  await seedEvent({ sessionId, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:02:00.000Z') });
  await seedEvent({ sessionId, type: 'correction_requested', timestamp: new Date('2026-03-01T09:03:00.000Z') });

  const res = await request(testApp()).get(`/api/statistics?sessionId=${sessionId}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.statistics.sessionId, sessionId);
  assert.equal(res.body.statistics.durationSeconds, 600);
  assert.equal(res.body.statistics.violationCount, 2);
  assert.equal(res.body.statistics.correctionCount, 1);
  assert.equal(res.body.statistics.startedAt, START.toISOString());
  assert.equal(res.body.statistics.endedAt, END.toISOString());
});

test('GET /api/statistics returns zero counts for an active session with no events', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'monitoring', createdAt: START, endedAt: null });

  const res = await request(testApp()).get(`/api/statistics?sessionId=${sessionId}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.statistics.violationCount, 0);
  assert.equal(res.body.statistics.correctionCount, 0);
  assert.equal(res.body.statistics.endedAt, null);
  assert.ok(res.body.statistics.durationSeconds >= 0, 'duration is a non-negative number');
});

test('GET /api/statistics is scoped to the requested session only', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const first = await seedSession({ state: 'ended', createdAt: START, endedAt: END });
  const second = await seedSession({ state: 'ended', createdAt: START, endedAt: END });
  await seedEvent({ sessionId: first, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:01:00.000Z') });
  await seedEvent({ sessionId: first, type: 'correction_requested', timestamp: new Date('2026-03-01T09:02:00.000Z') });
  await seedEvent({ sessionId: second, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:01:00.000Z') });
  await seedEvent({ sessionId: second, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:02:00.000Z') });

  const res = await request(testApp()).get(`/api/statistics?sessionId=${first}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.statistics.violationCount, 1);
  assert.equal(res.body.statistics.correctionCount, 1);
});

test('GET /api/statistics returns 404 for an unknown session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).get(`/api/statistics?sessionId=${randomUUID()}`);

  assert.equal(res.status, 404);
  assert.match(res.body.error, /not found/);
});

test('GET /api/statistics matches the /api/events history for the same session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const sessionId = await seedSession({ state: 'ended', createdAt: START, endedAt: END });
  await seedEvent({ sessionId, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:01:00.000Z') });
  await seedEvent({ sessionId, type: 'slouch_violation', timestamp: new Date('2026-03-01T09:02:00.000Z') });
  await seedEvent({ sessionId, type: 'correction_requested', timestamp: new Date('2026-03-01T09:03:00.000Z') });

  const eventsRes = await request(testApp()).get(`/api/events?sessionId=${sessionId}`);
  const statsRes = await request(testApp()).get(`/api/statistics?sessionId=${sessionId}`);

  const types = eventsRes.body.events.map((event) => event.type);
  const violations = types.filter((type) => type === 'slouch_violation').length;
  const corrections = types.filter((type) => type === 'correction_requested').length;

  assert.equal(statsRes.body.statistics.violationCount, violations);
  assert.equal(statsRes.body.statistics.correctionCount, corrections);
});