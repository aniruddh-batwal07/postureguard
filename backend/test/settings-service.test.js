const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsService } = require('../src/settings/service');
const { SETTINGS_DEFAULTS } = require('../src/settings/defaults');
const { MongoDBUnavailableError } = require('../src/persistence/mongo');

function fakeStore(overrides = {}) {
  let storedDoc = overrides.initialDoc !== undefined ? overrides.initialDoc : null;
  return {
    findSettings: overrides.findSettings || (async () => storedDoc),
    upsertSettings: overrides.upsertSettings || (async (patch) => {
      storedDoc = { ...storedDoc, ...patch };
      return storedDoc;
    }),
  };
}

// ── getSettings ────────────────────────────────────────────────────────────

test('getSettings returns defaults when no document is stored', async () => {
  const service = createSettingsService({ store: fakeStore({ initialDoc: null }) });
  const settings = await service.getSettings();

  assert.deepEqual(settings, { ...SETTINGS_DEFAULTS });
});

test('getSettings returns stored values merged with defaults', async () => {
  const service = createSettingsService({
    store: fakeStore({ initialDoc: { slouchThreshold: 0.3 } }),
  });
  const settings = await service.getSettings();

  assert.equal(settings.slouchThreshold, 0.3);
  assert.equal(settings.slouchDurationSeconds, SETTINGS_DEFAULTS.slouchDurationSeconds);
  assert.equal(settings.correctionDurationSeconds, SETTINGS_DEFAULTS.correctionDurationSeconds);
});

test('getSettings falls back to defaults when Mongo is unavailable (no throw)', async () => {
  const service = createSettingsService({
    store: fakeStore({
      findSettings: async () => { throw new MongoDBUnavailableError('down'); },
    }),
  });
  // Should not throw — graceful degradation
  const settings = await service.getSettings();
  assert.deepEqual(settings, { ...SETTINGS_DEFAULTS });
});

// ── updateSettings ─────────────────────────────────────────────────────────

test('updateSettings persists the patch and returns the full merged settings', async () => {
  const store = fakeStore();
  const service = createSettingsService({ store });

  const updated = await service.updateSettings({ slouchThreshold: 0.25 });

  assert.equal(updated.slouchThreshold, 0.25);
  assert.equal(updated.slouchDurationSeconds, SETTINGS_DEFAULTS.slouchDurationSeconds);
});

test('updateSettings persists all three fields when all are supplied', async () => {
  const store = fakeStore();
  const service = createSettingsService({ store });

  const updated = await service.updateSettings({
    slouchThreshold: 0.2,
    slouchDurationSeconds: 5.0,
    correctionDurationSeconds: 3.0,
  });

  assert.equal(updated.slouchThreshold, 0.2);
  assert.equal(updated.slouchDurationSeconds, 5.0);
  assert.equal(updated.correctionDurationSeconds, 3.0);
});

test('updateSettings propagates MongoDBUnavailableError on persistence failure', async () => {
  const service = createSettingsService({
    store: fakeStore({
      upsertSettings: async () => { throw new MongoDBUnavailableError('down'); },
    }),
  });

  await assert.rejects(
    () => service.updateSettings({ slouchThreshold: 0.2 }),
    (err) => err instanceof MongoDBUnavailableError,
  );
});

test('empty patch to updateSettings is a no-op and returns defaults', async () => {
  const service = createSettingsService({ store: fakeStore() });
  const updated = await service.updateSettings({});
  assert.deepEqual(updated, { ...SETTINGS_DEFAULTS });
});
