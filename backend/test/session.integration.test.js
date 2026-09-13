const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const mongo = require('../src/persistence/mongo');
const { createApp } = require('../src/app');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard_test';

let connected = false;

before(async () => {
  try {
    await mongo.connect({ uri: TEST_URI });
    connected = true;
    await mongo.getDb().collection('sessions').deleteMany({});
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

async function findPersisted(sessionId) {
  return sessionsCollection().findOne({ sessionId });
}

test('GET /api/sessions/active returns an empty response when nothing is active', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).get('/api/sessions/active');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { session: null });
});

test('POST /api/sessions creates and persists a session in MongoDB', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).post('/api/sessions');

  assert.equal(res.status, 201);
  assert.equal(res.body.session.state, 'baseline_capturing');
  assert.equal(res.body.session.endedAt, null);
  assert.ok(res.body.session.id, 'session has an id');

  const persisted = await findPersisted(res.body.session.id);
  assert.ok(persisted, 'session document persisted in MongoDB');
  assert.equal(persisted.state, 'baseline_capturing');
  assert.equal(persisted.state, res.body.session.state);
});

test('POST /api/sessions is rejected while a session is active', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).post('/api/sessions');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /active session/);
});

test('GET /api/sessions/active returns the active session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).get('/api/sessions/active');
  assert.equal(res.status, 200);
  assert.equal(res.body.session.state, 'baseline_capturing');
});

test('POST /api/sessions/:id/end transitions through ending to ended and persists it', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const active = await request(testApp()).get('/api/sessions/active');
  const id = active.body.session.id;

  const res = await request(testApp()).post(`/api/sessions/${id}/end`);
  assert.equal(res.status, 200);
  assert.equal(res.body.session.id, id);
  assert.equal(res.body.session.state, 'ended');
  assert.ok(res.body.session.endedAt, 'endedAt is set');

  const persisted = await findPersisted(id);
  assert.equal(persisted.state, 'ended');
  assert.ok(persisted.endedAt, 'endedAt persisted in MongoDB');
});

test('POST /api/sessions/:id/end is rejected after the session is already ended', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const active = await request(testApp()).get('/api/sessions/active');
  assert.equal(active.body.session, null);

  const ended = await sessionsCollection().findOne({ state: 'ended' });
  const res = await request(testApp()).post(`/api/sessions/${ended.sessionId}/end`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /cannot transition/);
});

test('POST /api/sessions/:id/end returns 404 for an unknown session', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).post('/api/sessions/00000000-0000-4000-8000-000000000000/end');
  assert.equal(res.status, 404);
  assert.match(res.body.error, /not found/);
});

test('a new session can be created after the previous one ended', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).post('/api/sessions');
  assert.equal(res.status, 201);
  assert.equal(res.body.session.state, 'baseline_capturing');
});