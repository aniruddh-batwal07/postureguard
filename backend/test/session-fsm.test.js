const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('../src/sessions/fsm');

test('defines the expected backend session states', () => {
  assert.deepEqual(fsm.VALID_STATES, [
    'idle',
    'baseline_capturing',
    'monitoring',
    'blocked',
    'ending',
    'ended',
  ]);
});

test('accepts valid transitions', () => {
  const valid = [
    ['idle', 'baseline_capturing'],
    ['baseline_capturing', 'monitoring'],
    ['baseline_capturing', 'ending'],
    ['monitoring', 'blocked'],
    ['monitoring', 'ending'],
    ['blocked', 'monitoring'],
    ['blocked', 'ending'],
    ['ending', 'ended'],
  ];
  for (const [from, to] of valid) {
    assert.equal(fsm.canTransition(from, to), true, `${from} -> ${to} should be allowed`);
  }
});

test('rejects invalid transitions', () => {
  const invalid = [
    ['idle', 'monitoring'],
    ['idle', 'blocked'],
    ['idle', 'ended'],
    ['baseline_capturing', 'idle'],
    ['baseline_capturing', 'blocked'],
    ['baseline_capturing', 'ended'],
    ['monitoring', 'idle'],
    ['monitoring', 'baseline_capturing'],
    ['monitoring', 'monitoring'],
    ['blocked', 'idle'],
    ['blocked', 'baseline_capturing'],
    ['blocked', 'blocked'],
    ['blocked', 'ended'],
    ['ending', 'monitoring'],
    ['ending', 'blocked'],
    ['ended', 'baseline_capturing'],
    ['ended', 'monitoring'],
    ['ended', 'ending'],
  ];
  for (const [from, to] of invalid) {
    assert.equal(fsm.canTransition(from, to), false, `${from} -> ${to} should be rejected`);
  }
});

test('ended is a terminal state', () => {
  for (const state of fsm.VALID_STATES) {
    assert.equal(fsm.canTransition('ended', state), false);
  }
});

test('unknown states are not valid', () => {
  assert.equal(fsm.isValidState('blocking'), false);
  assert.equal(fsm.isValidState('unblocking'), false);
  assert.equal(fsm.isValidState('monkey'), false);
  assert.equal(fsm.canTransition('blocking', 'blocked'), false);
  assert.equal(fsm.canTransition('monitoring', 'monkey'), false);
});