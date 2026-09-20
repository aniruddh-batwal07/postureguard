'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSerialTransport, autoDetectPort } = require('../src/hardware/serial-transport');
const { HardwareUnavailableError, HardwareTimeoutError } = require('../src/hardware/errors');

test('serial-transport: exposes the SerialTransport interface shape', () => {
  const transport = createSerialTransport({ path: 'COM99' });
  assert.equal(typeof transport.open, 'function');
  assert.equal(typeof transport.writeLine, 'function');
  assert.equal(typeof transport.readLine, 'function');
  assert.equal(typeof transport.close, 'function');
  assert.equal(transport.isOpen, false);
});

test('serial-transport: writeLine throws HardwareUnavailableError when not open', async () => {
  const transport = createSerialTransport({ path: 'COM99', autoDetect: false });
  await assert.rejects(
    () => transport.writeLine('STATUS'),
    (err) => err instanceof HardwareUnavailableError && err.code === 'HARDWARE_UNAVAILABLE',
  );
});

test('serial-transport: open rejects with HardwareUnavailableError on non-existent port', async () => {
  const transport = createSerialTransport({ path: 'COM_NON_EXISTENT_PORT_12345', autoDetect: false });
  await assert.rejects(
    () => transport.open(),
    (err) => err instanceof HardwareUnavailableError && err.code === 'HARDWARE_UNAVAILABLE',
  );
});

test('serial-transport: autoDetectPort returns null or string port path', async () => {
  const detected = await autoDetectPort();
  assert.ok(detected === null || typeof detected === 'string');
});
