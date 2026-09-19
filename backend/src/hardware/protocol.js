'use strict';

/**
 * M4.1 hardware protocol (frozen; resolves ADR-2 and ADR-4 concerns that are
 * about frame format — see docs/architecture.md §4.3).
 *
 * Newline-delimited ASCII token protocol. One request line → one response
 * line. Requests and responses are single uppercase tokens terminated by
 * '\n'. No checksums (student-project reliability bar).
 *
 * Commands (backend → device):  BLOCK | RETRIEVE | STATUS
 * BLOCK/STATUS/RETRIEVE are acknowledged only by their exact matching token:
 *   BLOCK    → BLOCK_OK
 *   RETRIEVE → RETRIEVE_OK
 *   STATUS   → STATE_DOCKED | STATE_BLOCKED | STATE_BUSY
 * Any `ERROR_*` token reports failure. Any other line is a protocol violation.
 */

const COMMANDS = Object.freeze({
  BLOCK: 'BLOCK',
  RETRIEVE: 'RETRIEVE',
  STATUS: 'STATUS',
});

/** Exact acknowledgement response for each non-STATUS command. */
const ACK_RESPONSES = Object.freeze({
  [COMMANDS.BLOCK]: 'BLOCK_OK',
  [COMMANDS.RETRIEVE]: 'RETRIEVE_OK',
});

/** Valid STATUS responses mapped to a normalized arm state. */
const STATE_RESPONSES = Object.freeze({
  STATE_DOCKED: 'docked',
  STATE_BLOCKED: 'blocked',
  STATE_BUSY: 'busy',
});

const ERROR_PREFIX = 'ERROR_';

function isErrorResponse(line) {
  return line.startsWith(ERROR_PREFIX);
}

function isStateResponse(line) {
  return Object.prototype.hasOwnProperty.call(STATE_RESPONSES, line);
}

function expectedAck(command) {
  return ACK_RESPONSES[command] || null;
}

/**
 * Classify a single device response line for an in-flight command.
 *
 * Returns one of:
 *   { kind: 'blank' }              - empty/whitespace line, keep waiting
 *   { kind: 'ok', value }          - the expected acknowledgement
 *   { kind: 'error', response }    - an ERROR_* token
 *   { kind: 'unexpected', response } - anything else (protocol violation)
 */
function classifyResponse(rawLine, command) {
  const line = typeof rawLine === 'string' ? rawLine.trim() : '';
  if (line.length === 0) {
    return { kind: 'blank' };
  }
  if (isErrorResponse(line)) {
    return { kind: 'error', response: line };
  }
  if (command === COMMANDS.STATUS) {
    if (isStateResponse(line)) {
      return { kind: 'ok', value: { state: STATE_RESPONSES[line] }, response: line };
    }
    return { kind: 'unexpected', response: line };
  }
  const ack = expectedAck(command);
  if (ack && line === ack) {
    return { kind: 'ok', value: line, response: line };
  }
  return { kind: 'unexpected', response: line };
}

module.exports = {
  COMMANDS,
  ACK_RESPONSES,
  STATE_RESPONSES,
  ERROR_PREFIX,
  isErrorResponse,
  isStateResponse,
  expectedAck,
  classifyResponse,
};