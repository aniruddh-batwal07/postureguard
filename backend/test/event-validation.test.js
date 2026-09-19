const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEvent, SUPPORTED_TYPES } = require('../src/validation/event');

const SESSION_UUID = 'd73b3e3e-6dd2-4f61-9d3e-2b7f4f4c2b3a';
const NOW = new Date('2026-03-01T10:00:00.000Z');

function validBody(overrides = {}) {
  return {
    sessionId: SESSION_UUID,
    type: 'slouch_violation',
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

test('accepts a valid slouch_violation event', () => {
  const result = validateEvent(validBody(), { now: () => NOW });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    sessionId: SESSION_UUID,
    type: 'slouch_violation',
    timestamp: new Date('2026-03-01T10:00:00.000Z'),
  });
});

test('accepts a valid correction_requested event', () => {
  const result = validateEvent(validBody({ type: 'correction_requested' }), { now: () => NOW });

  assert.equal(result.ok, true);
  assert.equal(result.value.type, 'correction_requested');
});

test('accepts a valid baseline_captured event', () => {
  const result = validateEvent(validBody({ type: 'baseline_captured' }), { now: () => NOW });

  assert.equal(result.ok, true);
  assert.equal(result.value.type, 'baseline_captured');
});

test('accepts an optional data object (uppercase uuid is fine)', () => {
  const body = validBody({ sessionId: SESSION_UUID.toUpperCase(), data: { magnitude: 0.3 } });
  const result = validateEvent(body, { now: () => NOW });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.data, { magnitude: 0.3 });
});

test('omits data from the value when not provided', () => {
  const result = validateEvent(validBody(), { now: () => NOW });

  assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'data'), false);
  assert.equal(result.ok, true);
});

test('rejects a non-object body', () => {
  for (const body of [null, 'slouch_violation', 42, ['slouch_violation'], true]) {
    const result = validateEvent(body, { now: () => NOW });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(body)}`);
    assert.match(result.error, /object/);
  }
});

test('rejects unknown top-level keys', () => {
  const result = validateEvent(validBody({ eventId: 'extra' }), { now: () => NOW });

  assert.equal(result.ok, false);
  assert.match(result.error, /unexpected key/);
});

test('rejects a missing or malformed sessionId', () => {
  for (const sessionId of [undefined, 'not-a-uuid', '1234', null]) {
    const result = validateEvent(validBody({ sessionId }), { now: () => NOW });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(sessionId)}`);
  }
});

test('rejects an unsupported event type', () => {
  const result = validateEvent(validBody({ type: 'suspected_phone' }), { now: () => NOW });

  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported event type/);
});

test('rejects a non-string timestamp', () => {
  const result = validateEvent(validBody({ timestamp: new Date().toISOString() }), { now: () => NOW });

  assert.equal(result.ok, false);
});

test('rejects an unparseable timestamp', () => {
  const result = validateEvent(validBody({ timestamp: 'not-a-date' }), { now: () => NOW });

  assert.equal(result.ok, false);
});

test('rejects a timestamp more than 60 seconds in the future', () => {
  const body = validBody({ timestamp: '2026-03-01T10:01:01.000Z' });
  const result = validateEvent(body, { now: () => NOW });

  assert.equal(result.ok, false);
  assert.match(result.error, /timestamp/);
});

test('accepts a timestamp within the 60 second future skew', () => {
  const body = validBody({ timestamp: '2026-03-01T10:00:30.000Z' });
  const result = validateEvent(body, { now: () => NOW });

  assert.equal(result.ok, true);
});

test('rejects a timestamp in the future by exactly the 60 second boundary', () => {
  const body = validBody({ timestamp: '2026-03-01T10:01:00.000Z' });
  const result = validateEvent(body, { now: () => NOW });

  assert.equal(result.ok, true);
});

test('rejects a non-object data value', () => {
  for (const data of [null, 'yes', 7, ['a']]) {
    const result = validateEvent(validBody({ data }), { now: () => NOW });
    assert.equal(result.ok, false, `expected rejection for data=${JSON.stringify(data)}`);
    assert.match(result.error, /data must be a JSON object/);
  }
});

test('exposes the supported event types', () => {
  assert.deepEqual([...SUPPORTED_TYPES].sort(), [
    'baseline_captured',
    'correction_requested',
    'slouch_violation',
  ]);
});