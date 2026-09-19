'use strict';

/**
 * Hardware error taxonomy (M4.1).
 *
 * - HardwareTimeoutError:    the device did not respond within the bounded
 *   command timeout. A timed-out command is a failure, never a success.
 * - HardwareDeviceError:     the device explicitly reported an `ERROR_*`
 *   response (stall, servo fault, busy, ...).
 * - HardwareProtocolError:   the device returned a well-formed line that is not
 *   the expected acknowledgement (e.g. BLOCK_OK while waiting for RETRIEVE_OK,
 *   or a non-STATE line for STATUS).
 * - HardwareUnavailableError: no transport (or no device) is configured.
 */

class HardwareTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HardwareTimeoutError';
    this.code = 'HARDWARE_TIMEOUT';
  }
}

class HardwareDeviceError extends Error {
  constructor(message, response) {
    super(message);
    this.name = 'HardwareDeviceError';
    this.code = 'HARDWARE_DEVICE_ERROR';
    this.response = response;
  }
}

class HardwareProtocolError extends Error {
  constructor(message, response) {
    super(message);
    this.name = 'HardwareProtocolError';
    this.code = 'HARDWARE_PROTOCOL_ERROR';
    this.response = response;
  }
}

class HardwareUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HardwareUnavailableError';
    this.code = 'HARDWARE_UNAVAILABLE';
  }
}

module.exports = {
  HardwareTimeoutError,
  HardwareDeviceError,
  HardwareProtocolError,
  HardwareUnavailableError,
};