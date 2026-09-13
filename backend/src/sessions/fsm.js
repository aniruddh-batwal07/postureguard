const VALID_STATES = [
  'idle',
  'baseline_capturing',
  'monitoring',
  'blocked',
  'ending',
  'ended',
];

const TRANSITIONS = {
  idle: ['baseline_capturing'],
  baseline_capturing: ['monitoring', 'ending'],
  monitoring: ['blocked', 'ending'],
  blocked: ['monitoring', 'ending'],
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