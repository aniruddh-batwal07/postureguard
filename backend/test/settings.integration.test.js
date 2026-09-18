const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const mongo = require('../src/persistence/mongo');
const { createApp } = require('../src/app');
const { SETTINGS_DEFAULTS } = require('../src/settings/defaults');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard_settings_test';

let connected = false;

before(async () => {
  try {
    await mongo.connect({ uri: TEST_URI });
    connected = true;
    await mongo.getDb().collection('settings').deleteMany({});
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

test('GET /api/settings returns defaults when no document exists', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const res = await request(testApp()).get('/api/settings');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.settings, { ...SETTINGS_DEFAULTS });
});

test('PUT /api/settings persists settings in MongoDB and GET returns updated values', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  // Clear any previous state.
  await mongo.getDb().collection('settings').deleteMany({});

  const putRes = await request(testApp()).put('/api/settings').send({ slouchThreshold: 0.25 });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.settings.slouchThreshold, 0.25);

  const getRes = await request(testApp()).get('/api/settings');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.settings.slouchThreshold, 0.25);
  // Other defaults should be preserved.
  assert.equal(getRes.body.settings.slouchDurationSeconds, SETTINGS_DEFAULTS.slouchDurationSeconds);
  assert.equal(getRes.body.settings.correctionDurationSeconds, SETTINGS_DEFAULTS.correctionDurationSeconds);
});

test('PUT /api/settings persists the document in the settings collection', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  await mongo.getDb().collection('settings').deleteMany({});

  await request(testApp()).put('/api/settings').send({ slouchDurationSeconds: 5.0 });

  const doc = await mongo.getDb().collection('settings').findOne({ _id: 'global' });
  assert.ok(doc, 'document persisted with _id=global');
  assert.equal(doc.slouchDurationSeconds, 5.0);
});

test('repeated PUT /api/settings accumulates updates without losing earlier fields', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  await mongo.getDb().collection('settings').deleteMany({});

  await request(testApp()).put('/api/settings').send({ slouchThreshold: 0.3 });
  await request(testApp()).put('/api/settings').send({ slouchDurationSeconds: 4.0 });

  const getRes = await request(testApp()).get('/api/settings');
  assert.equal(getRes.body.settings.slouchThreshold, 0.3);
  assert.equal(getRes.body.settings.slouchDurationSeconds, 4.0);
  assert.equal(getRes.body.settings.correctionDurationSeconds, SETTINGS_DEFAULTS.correctionDurationSeconds);
});

test('PUT /api/settings with invalid value leaves existing settings unchanged', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  await mongo.getDb().collection('settings').deleteMany({});
  await request(testApp()).put('/api/settings').send({ slouchThreshold: 0.2 });

  const badRes = await request(testApp()).put('/api/settings').send({ slouchThreshold: 999 });
  assert.equal(badRes.status, 400);

  const getRes = await request(testApp()).get('/api/settings');
  assert.equal(getRes.body.settings.slouchThreshold, 0.2);
});
