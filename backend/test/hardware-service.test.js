'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  HardwareTimeoutError,
  HardwareDeviceError,
  HardwareProtocolError,
  HardwareUnavailableError,
} = require('../src/hardware/errors');
const protocol = require('../src/hardware/protocol');
const { createHardwareService } = require('../src/hardware/service');
const { FakeSerialDevice } = require('./helpers/fake-serial-device');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function service(device, commandTimeoutMs = 100) {
  return createHardwareService({ transport: device, commandTimeoutMs });
}

test('protocol: BLOCK is acknowledged only by BLOCK_OK', () => {
  assert.equal(protocol.classifyResponse('BLOCK_OK', protocol.COMMANDS.BLOCK).kind, 'ok');
  assert.equal(protocol.classifyResponse('RETRIEVE_OK', protocol.COMMANDS.BLOCK).kind, 'unexpected');
  assert.equal(protocol.classifyResponse('STATE_BLOCKED', protocol.COMMANDS.BLOCK).kind, 'unexpected');
  assert.equal(protocol.classifyResponse('ERROR_STALL', protocol.COMMANDS.BLOCK).kind, 'error');
  assert.equal(protocol.classifyResponse('', protocol.COMMANDS.BLOCK).kind, 'blank');
  assert.equal(protocol.classifyResponse('   ', protocol.COMMANDS.BLOCK).kind, 'blank');
});

test('protocol: RETRIEVE is acknowledged only by RETRIEVE_OK', () => {
  assert.equal(protocol.classifyResponse('RETRIEVE_OK', protocol.COMMANDS.RETRIEVE).kind, 'ok');
  assert.equal(protocol.classifyResponse('BLOCK_OK', protocol.COMMANDS.RETRIEVE).kind, 'unexpected');
  assert.equal(protocol.classifyResponse('ERROR_SERVO_FAULT', protocol.COMMANDS.RETRIEVE).kind, 'error');
});

test('protocol: STATUS accepts only STATE_* responses and normalizes them', () => {
  assert.deepEqual(protocol.classifyResponse('STATE_DOCKED', protocol.COMMANDS.STATUS), {
    kind: 'ok',
    value: { state: 'docked' },
    response: 'STATE_DOCKED',
  });
  assert.deepEqual(protocol.classifyResponse('STATE_BLOCKED', protocol.COMMANDS.STATUS).value, { state: 'blocked' });
  assert.deepEqual(protocol.classifyResponse('STATE_BUSY', protocol.COMMANDS.STATUS).value, { state: 'busy' });
  assert.equal(protocol.classifyResponse('BLOCK_OK', protocol.COMMANDS.STATUS).kind, 'unexpected');
  assert.equal(protocol.classifyResponse('ERROR_STALL', protocol.COMMANDS.STATUS).kind, 'error');
});

test('BLOCK sends exactly BLOCK and resolves on BLOCK_OK', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = hardware.block();
  await flush();
  assert.deepEqual(device.sent, ['BLOCK']);

  device.reply('BLOCK_OK');
  assert.equal(await pending, 'BLOCK_OK');
});

test('successful BLOCK requires BLOCK_OK — any other ack fails', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = hardware.block();
  await flush();
  device.reply('RETRIEVE_OK');

  await assert.rejects(pending, HardwareProtocolError);
});

test('RETRIEVE requires RETRIEVE_OK', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = hardware.retrieve();
  await flush();
  assert.deepEqual(device.sent, ['RETRIEVE']);
  device.reply('RETRIEVE_OK');
  assert.equal(await pending, 'RETRIEVE_OK');

  const wrong = new FakeSerialDevice({ deferred: true });
  const failing = service(wrong);
  const pendingWrong = failing.retrieve();
  await flush();
  wrong.reply('BLOCK_OK');
  await assert.rejects(pendingWrong, HardwareProtocolError);
});

test('STATUS is handled correctly for every arm state', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  let pending = hardware.status();
  await flush();
  assert.deepEqual(device.sent, ['STATUS']);
  device.reply('STATE_DOCKED');
  assert.deepEqual(await pending, { state: 'docked' });

  pending = hardware.status();
  await flush();
  device.reply('STATE_BUSY');
  assert.deepEqual(await pending, { state: 'busy' });

  pending = hardware.status();
  await flush();
  device.reply('STATE_BLOCKED');
  assert.deepEqual(await pending, { state: 'blocked' });
});

test('STATUS rejects a non-state response', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = hardware.status();
  await flush();
  device.reply('BLOCK_OK');
  await assert.rejects(pending, HardwareProtocolError);
});

test('timeout: no response within the bound surfaces a clear timeout', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device, 20);

  await assert.rejects(hardware.block(), (err) => {
    assert.ok(err instanceof HardwareTimeoutError);
    assert.equal(err.code, 'HARDWARE_TIMEOUT');
    assert.match(err.message, /did not respond to BLOCK/);
    return true;
  });
  assert.deepEqual(device.sent, ['BLOCK']);
});

test('device ERROR response surfaces clearly and never resolves as success', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = hardware.block();
  await flush();
  device.reply('ERROR_STALL');

  await assert.rejects(pending, (err) => {
    assert.ok(err instanceof HardwareDeviceError);
    assert.equal(err.code, 'HARDWARE_DEVICE_ERROR');
    assert.equal(err.response, 'ERROR_STALL');
    return true;
  });
});

test('delayed response within the timeout still succeeds', async () => {
  const device = new FakeSerialDevice({ delayMs: 10 });
  const hardware = service(device, 200);

  assert.equal(await hardware.block(), 'BLOCK_OK');
  assert.deepEqual(device.sent, ['BLOCK']);
});

test('commands are serialized: nothing is sent while the previous command is in flight', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const blockP = hardware.block();
  const retrieveP = hardware.retrieve();
  const statusP = hardware.status();
  await flush();

  assert.deepEqual(device.sent, ['BLOCK'], 'retrieve/status must wait for the in-flight BLOCK');
  device.reply('BLOCK_OK');
  await blockP;
  await flush();
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE']);

  device.reply('RETRIEVE_OK');
  await retrieveP;
  await flush();
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE', 'STATUS']);

  device.reply('STATE_DOCKED');
  await statusP;
});

test('recorded command sequence matches exact ordering over a full cycle', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = [hardware.block(), hardware.retrieve(), hardware.status()];
  await flush();
  device.reply('BLOCK_OK');
  device.reply('RETRIEVE_OK');
  device.reply('STATE_DOCKED');
  await Promise.all(pending);

  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE', 'STATUS']);
});

test('a failed command does not poison the queue — the next command proceeds', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const blockP = hardware.block();
  const retrieveP = hardware.retrieve();
  await flush();

  device.reply('ERROR_BUSY');
  await assert.rejects(blockP, HardwareDeviceError);
  await flush();
  assert.deepEqual(device.sent, ['BLOCK', 'RETRIEVE'], 'retrieve proceeds after the failure');

  device.reply('RETRIEVE_OK');
  assert.equal(await retrieveP, 'RETRIEVE_OK');
});

test('unknown response lines are protocol violations, not successes', async () => {
  const device = new FakeSerialDevice({ deferred: true });
  const hardware = service(device);

  const pending = hardware.block();
  await flush();
  device.reply('HELLO');
  await assert.rejects(pending, HardwareProtocolError);
});

test('service refuses to be created without a transport', () => {
  assert.throws(() => createHardwareService({}), HardwareUnavailableError);
});