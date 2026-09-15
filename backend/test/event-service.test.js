const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createEventService,
  SessionNotActiveError,
} = require('../src/events/service');
const { SessionNotFoundError } = require('../src/sessions/service');
const { MongoDBUnavailableError } = require('../src/persistence/mongo');

const SESSION_UUID = 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a';
const fixedNow = () => new Date('2026-03-01T10:00:00.000Z');

function session(state) {
  return {
    sessionId: SESSION_UUID,
    state,
    createdAt: new Date('2026-03-01T09:00:00.000Z'),
    updatedAt: new Date('2026-03-01T09:00:00.000Z'),
    endedAt: null,
  };
}

function inMemoryEventStore() {
  const events = [];
  return {
    events,
    async insert(event) {
      events.push(event);
      return event;
    },
    async listBySession(sessionId, { limit } = {}) {
      const docs = events
        .filter((event) => event.sessionId === sessionId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
      return [...docs];
    },
  };
}

function eventInput(overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    type: 'slouch_violation',
    timestamp: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  };
}

test('recordEvent persists an event for an active session', async () => {
  const store = inMemoryEventStore();
  const service = createEventService({
    store,
    findSessionById: async () => session('monitoring'),
    now: fixedNow,
  });

  const event = await service.recordEvent(eventInput());

  assert.ok(event.eventId, 'event has an id');
  assert.equal(event.sessionId, SESSION_UUID);
  assert.equal(event.type, 'slouch_violation');
  assert.equal(event.timestamp.getTime(), fixedNow().getTime());
  assert.equal(event.createdAt.getTime(), fixedNow().getTime());

  const persisted = store.events[0];
  assert.ok(persisted, 'event was persisted');
  assert.equal(persisted.eventId, event.eventId);
});

test('recordEvent keeps optional data and omits it when absent', async () => {
  const withData = inMemoryEventStore();
  const serviceWithData = createEventService({
    store: withData,
    findSessionById: async () => session('blocked'),
    now: fixedNow,
  });
  await serviceWithData.recordEvent(eventInput({ data: { magnitude: 0.4 } }));
  assert.deepEqual(withData.events[0].data, { magnitude: 0.4 });

  const withoutData = inMemoryEventStore();
  const serviceWithoutData = createEventService({
    store: withoutData,
    findSessionById: async () => session('baseline_capturing'),
    now: fixedNow,
  });
  await serviceWithoutData.recordEvent(eventInput());
  assert.equal(Object.prototype.hasOwnProperty.call(withoutData.events[0], 'data'), false);
});

test('recordEvent rejects an unknown session', async () => {
  const service = createEventService({
    store: inMemoryEventStore(),
    findSessionById: async () => null,
    now: fixedNow,
  });

  await assert.rejects(service.recordEvent(eventInput()), SessionNotFoundError);
});

test('recordEvent rejects an ended session', async () => {
  const store = inMemoryEventStore();
  const service = createEventService({
    store,
    findSessionById: async () => session('ended'),
    now: fixedNow,
  });

  await assert.rejects(service.recordEvent(eventInput()), SessionNotActiveError);
  assert.equal(store.events.length, 0, 'no event persisted for an ended session');
});

test('recordEvent propagates a persistence failure', async () => {
  const failingStore = {
    async insert() {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist events');
    },
  };
  const service = createEventService({
    store: failingStore,
    findSessionById: async () => session('monitoring'),
    now: fixedNow,
  });

  await assert.rejects(service.recordEvent(eventInput()), MongoDBUnavailableError);
});

test('listEvents returns the persisted events for a session, oldest first', async () => {
  const store = inMemoryEventStore();
  await store.insert({ ...eventInput(), eventId: 'ev-1', createdAt: new Date('2026-03-01T10:00:01.000Z') });
  await store.insert({ ...eventInput({ type: 'correction_requested' }), eventId: 'ev-2', createdAt: new Date('2026-03-01T10:00:02.000Z') });
  const service = createEventService({
    store,
    findSessionById: async () => session('monitoring'),
    now: fixedNow,
  });

  const events = await service.listEvents(SESSION_UUID);

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.eventId), ['ev-1', 'ev-2']);
  assert.deepEqual(events.map((event) => event.type), ['slouch_violation', 'correction_requested']);
});

test('listEvents returns an empty history for a known session with no events', async () => {
  const store = inMemoryEventStore();
  const service = createEventService({
    store,
    findSessionById: async () => session('baseline_capturing'),
    now: fixedNow,
  });

  const events = await service.listEvents(SESSION_UUID);
  assert.deepEqual(events, []);
});

test('listEvents rejects an unknown session', async () => {
  const service = createEventService({
    store: inMemoryEventStore(),
    findSessionById: async () => null,
    now: fixedNow,
  });

  await assert.rejects(service.listEvents(SESSION_UUID), SessionNotFoundError);
});

test('listEvents does not leak events across sessions', async () => {
  const otherSession = '11111111-1111-4111-8111-111111111111';
  const store = inMemoryEventStore();
  await store.insert({ ...eventInput(), eventId: 'ev-mine', createdAt: fixedNow() });
  await store.insert({ ...eventInput({ sessionId: otherSession }), eventId: 'ev-other', createdAt: fixedNow() });
  const service = createEventService({
    store,
    findSessionById: async () => session('monitoring'),
    now: fixedNow,
  });

  const events = await service.listEvents(SESSION_UUID);
  assert.deepEqual(events.map((event) => event.eventId), ['ev-mine']);
});

test('listEvents respects the limit', async () => {
  const store = inMemoryEventStore();
  for (let i = 1; i <= 5; i += 1) {
    await store.insert({
      ...eventInput(),
      eventId: `ev-${i}`,
      createdAt: new Date(`2026-03-01T10:00:0${i}.000Z`),
    });
  }
  const service = createEventService({
    store,
    findSessionById: async () => session('monitoring'),
    now: fixedNow,
  });

  const events = await service.listEvents(SESSION_UUID, { limit: 2 });
  assert.deepEqual(events.map((event) => event.eventId), ['ev-1', 'ev-2']);
});

test('listEvents propagates a persistence failure', async () => {
  const failingStore = {
    async listBySession() {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist events');
    },
  };
  const service = createEventService({
    store: failingStore,
    findSessionById: async () => session('monitoring'),
    now: fixedNow,
  });

  await assert.rejects(service.listEvents(SESSION_UUID), MongoDBUnavailableError);
});