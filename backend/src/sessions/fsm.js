const VALID_STATES = [
  'idle',
  'baseline_capturing',
  'monitoring',
  'blocking',
  'blocked',
  'unblocking',
  'ending',
  'ended',
];

// 'blocking' / 'unblocking' are the M4.1 transient hardware states
// (architecture.md §7.1): BLOCK sent awaiting BLOCK_OK, RETRIEVE sent awaiting
// RETRIEVE_OK. On success blocking → blocked and unblocking → monitoring; on
// hardware failure the session falls back to the last safe state so a later
// violation/correction can retry. ending is reachable from every active state
// so an end-of-session RETRIEVE can always return the arm to dock (ADR-5).
const TRANSITIONS = {
  idle: ['baseline_capturing'],
  baseline_capturing: ['monitoring', 'ending'],
  monitoring: ['blocking', 'ending'],
  blocking: ['blocked', 'monitoring', 'ending'],
  blocked: ['unblocking', 'ending'],
  unblocking: ['monitoring', 'blocked', 'ending'],
  ending: ['ended'],
  ended: [],
};

function isValidState(state) {
  return VALID_STATES.includes(state);
}

function canTransition(from, to) {
  return isValidState(from) && isValidState(to) && TRANSITIONS[from].includes(to);
}

module.exports = { VALID_STATES, TRANSITIONS, isValidState, canTransition };