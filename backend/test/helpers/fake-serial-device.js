'use strict';

const { HardwareTimeoutError } = require('../../src/hardware/errors');

const DEFAULT_RESPONSES = Object.freeze({
  BLOCK: 'BLOCK_OK',
  RETRIEVE: 'RETRIEVE_OK',
  STATUS: 'STATE_DOCKED',
  HOME: 'HOME_OK',
});

/**
 * Deterministic fake serial device for M4.1 tests.
 *
 * Implements the same line-transport shape the real Arduino driver will
 * provide (see src/hardware/transport.js). It records every written frame in
 * `sent` so tests can assert exact command sequencing, and lets tests drive
 * the device's behaviour:
 *
 * - auto mode (default): each command is answered from `responses` after
 *   `delayMs`; override per command with setResponse / setError, or silence it
 *   with setNoResponse (→ timeout).
 * - deferred mode: commands are recorded but never auto-responded; the test
 *   delivers responses explicitly with `reply(line)`. This makes race/timing
 *   tests fully deterministic.
 */
class FakeSerialDevice {
  constructor({ delayMs = 0, responses = {}, noResponseCommands = new Set(), deferred = false } = {}) {
    this.delayMs = delayMs;
    this.responses = { ...DEFAULT_RESPONSES, ...responses };
    this.noResponseCommands = new Set(noResponseCommands);
    this.deferred = deferred;
    this.sentCommands = [];
    this.replyQueue = [];
    this.reader = null;
  }

  get sent() {
    return this.sentCommands;
  }

  async open() {
    return true;
  }

  async close() {
    return true;
  }

  setDelayMs(ms) {
    this.delayMs = ms;
    return this;
  }

  setResponse(command, response) {
    this.responses[command] = response;
    return this;
  }

  setError(command, errorResponse) {
    this.responses[command] = errorResponse;
    return this;
  }

  setNoResponse(command, on = true) {
    if (on) {
      this.noResponseCommands.add(command);
    } else {
      this.noResponseCommands.delete(command);
    }
    return this;
  }

  async writeLine(line) {
    this.sentCommands.push(line);
    if (this.deferred || this.noResponseCommands.has(line)) {
      return;
    }
    const response = this.responses[line];
    if (response === undefined) {
      return;
    }
    if (this.delayMs > 0) {
      setTimeout(() => this.enqueueReply(response), this.delayMs);
    } else {
      this.enqueueReply(response);
    }
  }

  async readLine(timeoutMs) {
    if (this.replyQueue.length > 0) {
      return this.replyQueue.shift();
    }
    return new Promise((resolve, reject) => {
      const reader = { resolve, reject };
      this.reader = reader;
      if (timeoutMs !== undefined && timeoutMs !== null) {
        reader.timer = setTimeout(() => {
          if (this.reader === reader) {
            this.reader = null;
            reject(new HardwareTimeoutError(`no response within ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
    });
  }

  /**
   * Deliver a response line explicitly (deferred mode only).
   */
  reply(line) {
    if (!this.deferred) {
      throw new Error('FakeSerialDevice.reply() requires deferred: true');
    }
    this.enqueueReply(line);
    return this;
  }

  enqueueReply(response) {
    this.replyQueue.push(response);
    if (this.reader) {
      const reader = this.reader;
      this.reader = null;
      if (reader.timer) {
        clearTimeout(reader.timer);
      }
      reader.resolve(this.replyQueue.shift());
    }
  }

  reset() {
    this.sentCommands = [];
    this.replyQueue = [];
    this.reader = null;
    return this;
  }
}

module.exports = { FakeSerialDevice, DEFAULT_RESPONSES };