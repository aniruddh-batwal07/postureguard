const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { MongoDBUnavailableError } = require('../src/persistence/mongo');
const { SETTINGS_DEFAULTS } = require('../src/settings/defaults');

function fakePersistence() {
  return {
    async status() { return { connected: true }; },
    getDb() { return null; },
  };
}

function fakeSettingsService(overrides = {}) {
  return {
    getSettings: overrides.getSettings || (async () => ({ ...SETTINGS_DEFAULTS })),
    updateSettings: overrides.updateSettings || (async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch })),
  };
}

function app(overrides = {}) {
  return createApp({
    persistence: fakePersistence(),
    sessionService: { createSession: async () => null, getActiveSession: async () => null, endSession: async () => null },
    eventService: { recordEvent: async () => null, listEvents: async () => [] },
    statisticsService: { getStatistics: async () => null },
    settingsService: fakeSettingsService(overrides),
  });
}

// ── GET /api/settings ──────────────────────────────────────────────────────

test('GET /api/settings returns current settings with all fields', async () => {
  const res = await request(app()).get('/api/settings');

  assert.equal(res.status, 200);
  assert.ok(res.body.settings, 'response has settings key');
  assert.equal(res.body.settings.slouchThreshold, SETTINGS_DEFAULTS.slouchThreshold);
  assert.equal(res.body.settings.slouchDurationSeconds, SETTINGS_DEFAULTS.slouchDurationSeconds);
  assert.equal(res.body.settings.correctionDurationSeconds, SETTINGS_DEFAULTS.correctionDurationSeconds);
});

test('GET /api/settings returns defaults when getSettings falls back', async () => {
  const res = await request(app({
    getSettings: async () => ({ ...SETTINGS_DEFAULTS }),
  })).get('/api/settings');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.settings, { ...SETTINGS_DEFAULTS });
});

// ── PUT /api/settings — valid updates ──────────────────────────────────────

test('PUT /api/settings updates slouchThreshold and returns merged settings', async () => {
  const res = await request(app({
    updateSettings: async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch }),
  })).put('/api/settings').send({ slouchThreshold: 0.25 });

  assert.equal(res.status, 200);
  assert.equal(res.body.settings.slouchThreshold, 0.25);
  assert.equal(res.body.settings.slouchDurationSeconds, SETTINGS_DEFAULTS.slouchDurationSeconds);
});

test('PUT /api/settings updates slouchDurationSeconds', async () => {
  const res = await request(app({
    updateSettings: async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch }),
  })).put('/api/settings').send({ slouchDurationSeconds: 5.0 });

  assert.equal(res.status, 200);
  assert.equal(res.body.settings.slouchDurationSeconds, 5.0);
});

test('PUT /api/settings updates correctionDurationSeconds', async () => {
  const res = await request(app({
    updateSettings: async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch }),
  })).put('/api/settings').send({ correctionDurationSeconds: 3.5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.settings.correctionDurationSeconds, 3.5);
});

test('PUT /api/settings updates multiple fields at once', async () => {
  const res = await request(app({
    updateSettings: async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch }),
  })).put('/api/settings').send({ slouchThreshold: 0.3, slouchDurationSeconds: 4.0, correctionDurationSeconds: 1.5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.settings.slouchThreshold, 0.3);
  assert.equal(res.body.settings.slouchDurationSeconds, 4.0);
  assert.equal(res.body.settings.correctionDurationSeconds, 1.5);
});

test('PUT /api/settings with an empty body is a no-op and returns 200', async () => {
  const res = await request(app()).put('/api/settings').send({});

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.settings, { ...SETTINGS_DEFAULTS });
});

// ── PUT /api/settings — unknown fields ─────────────────────────────────────

test('PUT /api/settings rejects a single unknown field with 400', async () => {
  const res = await request(app()).put('/api/settings').send({ violationDelay: 5 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown field/);
  assert.match(res.body.error, /violationDelay/);
});

test('PUT /api/settings rejects multiple unknown fields with 400', async () => {
  const res = await request(app()).put('/api/settings').send({ foo: 1, bar: 2 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown field/);
});

// ── PUT /api/settings — type/finite validation ─────────────────────────────

test('PUT /api/settings rejects a string slouchThreshold', async () => {
  const res = await request(app()).put('/api/settings').send({ slouchThreshold: 'high' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /slouchThreshold/);
});

test('PUT /api/settings rejects NaN slouchThreshold', async () => {
  // JSON does not represent NaN natively — test with a numeric-string that
  // slips through JSON parsing as a string or use a known coercion path.
  const res = await request(app())
    .put('/api/settings')
    .set('Content-Type', 'application/json')
    .send('{"slouchThreshold": "NaN"}');

  assert.equal(res.status, 400);
});

test('PUT /api/settings rejects a non-finite slouchDurationSeconds', async () => {
  // JSON.stringify converts Infinity to null; send raw JSON to test the validator.
  const res = await request(app())
    .put('/api/settings')
    .set('Content-Type', 'application/json')
    .send('{"slouchDurationSeconds": null}');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /slouchDurationSeconds/);
});

// ── PUT /api/settings — range validation ───────────────────────────────────

test('PUT /api/settings rejects slouchThreshold < 0', async () => {
  const res = await request(app()).put('/api/settings').send({ slouchThreshold: -0.1 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /slouchThreshold/);
});

test('PUT /api/settings rejects slouchThreshold > 1', async () => {
  const res = await request(app()).put('/api/settings').send({ slouchThreshold: 1.1 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /slouchThreshold/);
});

test('PUT /api/settings accepts slouchThreshold = 0 (edge)', async () => {
  const res = await request(app({
    updateSettings: async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch }),
  })).put('/api/settings').send({ slouchThreshold: 0 });

  assert.equal(res.status, 200);
  assert.equal(res.body.settings.slouchThreshold, 0);
});

test('PUT /api/settings accepts slouchThreshold = 1 (edge)', async () => {
  const res = await request(app({
    updateSettings: async (patch) => ({ ...SETTINGS_DEFAULTS, ...patch }),
  })).put('/api/settings').send({ slouchThreshold: 1 });

  assert.equal(res.status, 200);
  assert.equal(res.body.settings.slouchThreshold, 1);
});

test('PUT /api/settings rejects slouchDurationSeconds <= 0', async () => {
  const res = await request(app()).put('/api/settings').send({ slouchDurationSeconds: 0 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /slouchDurationSeconds/);
});

test('PUT /api/settings rejects slouchDurationSeconds > 60', async () => {
  const res = await request(app()).put('/api/settings').send({ slouchDurationSeconds: 61 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /slouchDurationSeconds/);
});

test('PUT /api/settings rejects correctionDurationSeconds <= 0', async () => {
  const res = await request(app()).put('/api/settings').send({ correctionDurationSeconds: -1 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /correctionDurationSeconds/);
});

test('PUT /api/settings rejects correctionDurationSeconds > 60', async () => {
  const res = await request(app()).put('/api/settings').send({ correctionDurationSeconds: 120 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /correctionDurationSeconds/);
});

// ── PUT /api/settings — Mongo failure → 503 ────────────────────────────────

test('PUT /api/settings returns 503 when Mongo is unavailable', async () => {
  const res = await request(app({
    updateSettings: async () => {
      throw new MongoDBUnavailableError('MongoDB is not connected');
    },
  })).put('/api/settings').send({ slouchThreshold: 0.2 });

  assert.equal(res.status, 503);
  assert.match(res.body.error, /MongoDB/);
});

// ── Malformed JSON body ─────────────────────────────────────────────────────

test('PUT /api/settings returns 400 for malformed JSON', async () => {
  const res = await request(app())
    .put('/api/settings')
    .set('Content-Type', 'application/json')
    .send('not-json');

  assert.equal(res.status, 400);
});
