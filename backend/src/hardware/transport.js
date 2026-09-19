'use strict';

/**
 * Serial transport interface — the hardware/software seam (architecture.md
 * §9) and the vehicle for ADR-2.
 *
 * A transport wraps the physical/virtual serial link and exposes a tiny
 * line-based request/response API. The real Arduino driver (M5.3) and the
 * test double (test/helpers/fake-serial-device.js) both implement this exact
 * shape, so swapping one for the other touches only this seam. The backend
 * hardware service (src/hardware/service.js) is the only consumer that speaks
 * the protocol through this interface.
 *
 * @typedef {Object} SerialTransport
 * @property {() => Promise<void>} open
 *    Open the device. Idempotent; called by the owner before issuing commands.
 * @property {(line: string) => Promise<void>} writeLine
 *    Send one newline-terminated request frame. Resolves once the frame is
 *    written to the link.
 * @property {(timeoutMs: number) => Promise<string>} readLine
 *    Resolve with the next complete response line (trimmed of newline), or
 *    reject with `HardwareTimeoutError` if no line arrives within timeoutMs.
 * @property {() => Promise<void>} close
 *    Close the device. Idempotent.
 */

module.exports = {};