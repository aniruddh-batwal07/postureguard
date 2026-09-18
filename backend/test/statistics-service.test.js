const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStatisticsService } = require('../src/statistics/service');
const { SessionNotFoundError } = require('../src/sessions/service');
const { MongoDBUnavailableError } = require('../src/persistence/mongo');

const SESSION_ID = 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a';

function sessionStore(seed) {
  return {
    async findBySessionId(sessionId) {
      return seed && seed.sessionId === sessionId ? { ...seed } : null;
    },
  };
}

function eventStore(counts) {
  return {
    async countsBySession() {
      return counts;
    },
  };
}

function seed({ state = 'ended', createdAt, endedAt = null } = {}) {
  return { sessionId: SESSION_ID, state, createdAt, updatedAt: createdAt, endedAt };
}

test('getStatistics reports counts and duration for an ended session', async () => {
  const createdAt = new Date('2026-03-01T09:00:00.000Z');
  const endedAt = new Date('2026-03-01T09:10:00.000Z');
  const service = createStatisticsService({
    sessionStore: sessionStore(seed({ createdAt, endedAt })),
    eventStore: eventStore({ slouch_violation: 3, correction_requested: 2 }),
  });

  const stats = await service.getStatistics(SESSION_ID);

  assert.equal(stats.sessionId, SESSION_ID);
  assert.equal(stats.durationSeconds, 600);
  assert.equal(stats.violationCount, 3);
  assert.equal(stats.correctionCount, 2);
  assert.equal(stats.startedAt.getTime(), createdAt.getTime());
  assert.equal(stats.endedAt.getTime(), endedAt.getTime());
});

test('getStatistics for an active session computes duration against now and endedAt is null', async () => {
  const createdAt = new Date('2026-03-01T09:00:00.000Z');
  const service = createStatisticsService({
    sessionStore: sessionStore(seed({ state: 'monitoring', createdAt, endedAt: null })),
    eventStore: eventStore({ slouch_violation: 1 }),
    now: () => new Date('2026-03-01T09:05:30.000Z'),
  });

  const stats = await service.getStatistics(SESSION_ID);

  assert.equal(stats.durationSeconds, 330);
  assert.equal(stats.endedAt, null);
});

test('getStatistics reports zero counts for a session with no events', async () => {
  const createdAt = new Date('2026-03-01T09:00:00.000Z');
  const service = createStatisticsService({
    sessionStore: sessionStore(seed({ createdAt, endedAt: createdAt })),
    eventStore: eventStore({}),
  });

  const stats = await service.getStatistics(SESSION_ID);

  assert.equal(stats.violationCount, 0);
  assert.equal(stats.correctionCount, 0);
  assert.equal(stats.durationSeconds, 0);
});

test('getStatistics only counts known violation and correction event types', async () => {
  const createdAt = new Date('2026-03-01T09:00:00.000Z');
  const service = createStatisticsService({
    sessionStore: sessionStore(seed({ createdAt })),
    eventStore: eventStore({
      slouch_violation: 2,
      phone_violation: 1,
      correction_requested: 4,
      baseline_captured: 1,
      kept_misc_unrelated: 99,
    }),
  });

  const stats = await service.getStatistics(SESSION_ID);

  assert.equal(stats.violationCount, 3);
  assert.equal(stats.correctionCount, 4);
});

test('getStatistics rejects an unknown session', async () => {
  const service = createStatisticsService({
    sessionStore: sessionStore(null),
    eventStore: eventStore({}),
  });

  await assert.rejects(service.getStatistics(SESSION_ID), SessionNotFoundError);
});

test('getStatistics propagates a MongoDB failure from the event store', async () => {
  const createdAt = new Date('2026-03-01T09:00:00.000Z');
  const service = createStatisticsService({
    sessionStore: sessionStore(seed({ createdAt })),
    eventStore: {
      async countsBySession() {
        throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist events');
      },
    },
  });

  await assert.rejects(
    service.getStatistics(SESSION_ID),
    (err) => err instanceof MongoDBUnavailableError && err.code === 'MONGO_UNAVAILABLE',
  );
});