const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const mongo = require('../src/persistence/mongo');
const { MongoDBUnavailableError } = require('../src/persistence/mongo');
const { createApp } = require('../src/app');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard_test';

let connected = false;

before(async () => {
  try {
    await mongo.connect({ uri: TEST_URI });
    connected = true;
  } catch (err) {
    console.error(`[integration] cannot connect to ${TEST_URI}: ${err.message}`);
  }
});

after(async () => {
  await mongo.disconnect();
});

test('connects to the running MongoDB and status() reports connected', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  assert.equal(mongo.isConnected(), true);
  await mongo.ping();
  assert.deepEqual(await mongo.status(), { connected: true });
});

test('GET /api/status reports mongo connected through the real persistence module', async (t) => {
  if (!connected) return t.skip(`MongoDB unavailable at ${TEST_URI}`);

  const app = createApp({ persistence: mongo });
  const res = await request(app).get('/api/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.mongo.connected, true);
});

test('Mongo unavailable: status reports disconnected instead of crashing', async () => {
  await mongo.disconnect();
  assert.equal(mongo.isConnected(), false);

  const status = await mongo.status();
  assert.equal(status.connected, false);
  assert.ok(status.error, 'expected a failure reason');

  await assert.rejects(mongo.ping(), (err) => {
    assert.equal(err.name, 'MongoDBUnavailableError');
    assert.equal(err.code, 'MONGO_UNAVAILABLE');
    return true;
  });

  const app = createApp({ persistence: mongo });
  const res = await request(app).get('/api/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.mongo.connected, false);
});