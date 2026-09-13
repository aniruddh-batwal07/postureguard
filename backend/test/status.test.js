const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

function fakePersistence(statusResult) {
  return {
    async status() {
      if (statusResult instanceof Error) throw statusResult;
      return statusResult;
    },
  };
}

test('GET /api/status returns backend status', async () => {
  const app = createApp({ persistence: fakePersistence({ connected: true }) });
  const res = await request(app).get('/api/status');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /json/);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.service, 'postureguard-backend');
  assert.equal(typeof res.body.uptime, 'number');
});

test('GET /api/status reports mongo connected', async () => {
  const app = createApp({ persistence: fakePersistence({ connected: true }) });
  const res = await request(app).get('/api/status');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.mongo, { connected: true });
});

test('GET /api/status reports mongo disconnected without failing the request', async () => {
  const app = createApp({
    persistence: fakePersistence({ connected: false, error: 'ECONNREFUSED' }),
  });
  const res = await request(app).get('/api/status');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.mongo.connected, false);
  assert.equal(res.body.mongo.error, 'ECONNREFUSED');
});

test('GET /api/status stays 200 when the persistence check itself throws', async () => {
  const app = createApp({ persistence: fakePersistence(new Error('boom')) });
  const res = await request(app).get('/api/status');

  assert.equal(res.status, 200);
  assert.equal(res.body.mongo.connected, false);
  assert.equal(res.body.mongo.error, 'boom');
});

test('unknown route returns a JSON 404', async () => {
  const app = createApp({ persistence: fakePersistence({ connected: true }) });
  const res = await request(app).get('/api/does-not-exist');

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Not Found');
});