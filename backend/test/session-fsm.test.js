const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('../src/sessions/fsm');

test('defines the expected backend session states', () => {
  assert.deepEqual(fsm.VALID_STATES, [
    'idle',
    'baseline_capturing',
    'monitoring',
    'blocking',
    'blocked',
    'unblocking',
    'ending',
    'ended',
  ]);
});

test('accepts valid transitions', () => {
  const valid = [
    ['idle', 'baseline_capturing'],
    ['baseline_capturing', 'monitoring'],
    ['baseline_capturing', 'ending'],
    ['monitoring', 'blocking'],
    ['blocking', 'blocked'],
    ['blocking', 'monitoring'],
    ['blocking', 'ending'],
    ['monitoring', 'ending'],
    ['blocked', 'unblocking'],
    ['unblocking', 'monitoring'],
    ['unblocking', 'blocked'],
    ['blocked', 'ending'],
    ['unblocking', 'ending'],
    ['ending', 'ended'],
  ];
  for (const [from, to] of valid) {
    assert.equal(fsm.canTransition(from, to), true, `${from} -> ${to} should be allowed`);
  }
});

test('rejects invalid transitions', () => {
  const invalid = [
    ['idle', 'monitoring'],
    ['idle', 'blocking'],
    ['idle', 'blocked'],
    ['idle', 'unblocking'],
    ['idle', 'ended'],
    ['baseline_capturing', 'idle'],
    ['baseline_capturing', 'blocking'],
    ['baseline_capturing', 'blocked'],
    ['baseline_capturing', 'unblocking'],
    ['baseline_capturing', 'ended'],
    ['monitoring', 'idle'],
    ['monitoring', 'baseline_capturing'],
    ['monitoring', 'blocked'],
    ['monitoring', 'unblocking'],
    ['monitoring', 'monitoring'],
    ['blocking', 'idle'],
    ['blocking', 'baseline_capturing'],
    ['blocking', 'blocking'],
    ['blocking', 'unblocking'],
    ['blocking', 'ended'],
    ['blocked', 'idle'],
    ['blocked', 'baseline_capturing'],
    ['blocked', 'blocking'],
    ['blocked', 'blocked'],
    ['blocked', 'monitoring'],
    ['blocked', 'ended'],
    ['unblocking', 'idle'],
    ['unblocking', 'baseline_capturing'],
    ['unblocking', 'blocking'],
    ['unblocking', 'unblocking'],
    ['unblocking', 'ended'],
    ['ending', 'monitoring'],
    ['ending', 'blocking'],
    ['ending', 'blocked'],
    ['ending', 'unblocking'],
    ['ended', 'baseline_capturing'],
    ['ended', 'monitoring'],
    ['ended', 'blocking'],
    ['ended', 'blocked'],
    ['ended', 'unblocking'],
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
  assert.equal(fsm.isValidState('monkey'), false);
  assert.equal(fsm.isValidState('busy'), false);
  assert.equal(fsm.canTransition('blocking', 'monkey'), false);
  assert.equal(fsm.canTransition('monitoring', 'monkey'), false);
});