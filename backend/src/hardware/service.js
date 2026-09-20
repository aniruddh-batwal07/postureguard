'use strict';

const config = require('../config');
const protocol = require('./protocol');
const {
  HardwareTimeoutError,
  HardwareDeviceError,
  HardwareProtocolError,
  HardwareUnavailableError,
} = require('./errors');

/**
 * Backend hardware service (M4.1).
 *
 * Speaks the frozen BLOCK/RETRIEVE/STATUS protocol (docs/architecture.md §4.3)
 * against a serial-style transport. The Node backend remains the single
 * source of truth for state; this service only communicates with the device
 * and reports the result.
 *
 * Guarantees:
 * - All commands are serialized through a FIFO queue, so BLOCK and RETRIEVE
 *   can never be on the wire concurrently.
 * - Every command waits for its exact acknowledgement (BLOCK_OK / RETRIEVE_OK
 *   / STATE_*) inside a bounded timeout.
 * - A command never resolves unless the expected acknowledgement was received.
 *   Timeouts surface as HardwareTimeoutError, explicit ERROR_* as
 *   HardwareDeviceError, and mismatched acknowledgements as
 *   HardwareProtocolError.
 */
function createHardwareService({ transport, commandTimeoutMs = config.hardwareCommandTimeoutMs, now = Date.now } = {}) {
  if (!transport) {
    throw new HardwareUnavailableError('hardware transport is not configured');
  }

  let chain = Promise.resolve();

  function enqueue(operation) {
    const run = chain.then(operation, operation);
    chain = run.catch(() => {});
    return run;
  }

  async function request(command) {
    // Drop stale unread device lines so this command can only ever match its
    // own acknowledgement. Without this, a late ack from a previously
    // timed-out command (or a boot banner arriving after the boot-delay
    // window) desynchronizes the read loop and the real command gets
    // rejected as a protocol error — the "arm sometimes doesn't act" bug.
    if (typeof transport.flushInput === 'function') {
      transport.flushInput();
    }
    await transport.writeLine(command);
    const deadline = now() + commandTimeoutMs;
    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new HardwareTimeoutError(
          `device did not respond to ${command} within ${commandTimeoutMs}ms`,
        );
      }
      let raw;
      try {
        raw = await transport.readLine(remaining);
      } catch (err) {
        if (err instanceof HardwareTimeoutError) {
          throw new HardwareTimeoutError(
            `device did not respond to ${command} within ${commandTimeoutMs}ms`,
          );
        }
        throw err;
      }
      const verdict = protocol.classifyResponse(raw, command);
      if (verdict.kind === 'ok') {
        return verdict.value;
      }
      if (verdict.kind === 'error') {
        throw new HardwareDeviceError(
          `device reported a fault for ${command}: ${verdict.response}`,
          verdict.response,
        );
      }
      if (verdict.kind === 'blank') {
        continue;
      }
      const expected = protocol.expectedAck(command) || 'a STATE_* response';
      throw new HardwareProtocolError(
        `device returned unexpected response "${verdict.response}" for ${command}; expected ${expected}`,
        verdict.response,
      );
    }
  }

  function block() {
    return enqueue(() => request(protocol.COMMANDS.BLOCK));
  }

  function retrieve() {
    return enqueue(() => request(protocol.COMMANDS.RETRIEVE));
  }

  function status() {
    return enqueue(() => request(protocol.COMMANDS.STATUS));
  }

  return { block, retrieve, status };
}

module.exports = { createHardwareService };