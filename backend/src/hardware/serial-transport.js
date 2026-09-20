'use strict';

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const {
  HardwareTimeoutError,
  HardwareUnavailableError,
} = require('./errors');

/**
 * Auto-detect an Arduino Uno serial port if not explicitly configured or if disconnected.
 */
async function autoDetectPort() {
  const ports = await SerialPort.list();
  for (const p of ports) {
    const desc = `${p.manufacturer || ''} ${p.friendlyName || ''} ${p.description || ''}`.toLowerCase();
    if (desc.includes('ch340') || desc.includes('arduino') || desc.includes('usb-serial')) {
      return p.path;
    }
  }
  return null;
}

async function resolvePort(preferredPath, allowAutoDetect = true) {
  const ports = await SerialPort.list();
  if (preferredPath) {
    const exists = ports.some((p) => p.path.toUpperCase() === preferredPath.toUpperCase());
    if (exists) {
      return preferredPath;
    }
  }
  // Fall back to auto-detection if preferred port is not currently connected.
  // Tests can pass allowAutoDetect=false for deterministic rejection.
  return allowAutoDetect ? autoDetectPort() : null;
}

/**
 * Real Serial Transport for Arduino Uno (M5.3).
 *
 * Implements the SerialTransport interface (architecture.md §9, transport.js):
 * - open()
 * - writeLine(line)
 * - readLine(timeoutMs)
 * - close()
 */
function createSerialTransport({ path, baudRate = 115200, bootDelayMs = 2000, autoDetect = true } = {}) {
  let port = null;
  let parser = null;
  let isOpen = false;
  const lineQueue = [];
  let pendingReader = null;

  function onLine(data) {
    const line = data.trim();
    if (!line) return;
    if (line.startsWith('PostureGuard') || line.includes('Ready')) {
      return;
    }
    if (pendingReader) {
      const { resolve, timer } = pendingReader;
      pendingReader = null;
      if (timer) clearTimeout(timer);
      resolve(line);
    } else {
      lineQueue.push(line);
    }
  }

  async function open() {
    if (isOpen && port && port.isOpen) {
      return;
    }

    const targetPath = await resolvePort(path, autoDetect);


    if (!targetPath) {
      throw new HardwareUnavailableError('no serial port specified or detected');
    }

    await new Promise((resolve, reject) => {
      port = new SerialPort({ path: targetPath, baudRate, autoOpen: false });

      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', onLine);

      port.on('error', (err) => {
        if (!isOpen) {
          reject(new HardwareUnavailableError(`cannot open serial port ${targetPath}: ${err.message}`));
        }
      });

      port.on('close', () => {
        isOpen = false;
        port = null;
      });

      port.open((err) => {
        if (err) {
          return reject(new HardwareUnavailableError(`failed to open serial port ${targetPath}: ${err.message}`));
        }
        isOpen = true;
        resolve();
      });
    });

    // Allow Arduino Uno bootloader reset after DTR toggle
    if (bootDelayMs > 0) {
      await new Promise((res) => setTimeout(res, bootDelayMs));
      // Discard initial boot greeting banner so it doesn't pollute readLine()
      lineQueue.length = 0;
    }
  }

  async function writeLine(line) {
    if (!isOpen || !port || !port.isOpen) {
      try {
        await open();
      } catch (err) {
        if (err instanceof HardwareUnavailableError) throw err;
        throw new HardwareUnavailableError(`serial port is not open: ${err.message}`);
      }
    }
    await new Promise((resolve, reject) => {
      port.write(`${line}\n`, (err) => {
        if (err) return reject(new HardwareUnavailableError(`write error: ${err.message}`));
        resolve();
      });
    });
  }

  async function readLine(timeoutMs) {
    if (lineQueue.length > 0) {
      return lineQueue.shift();
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs !== undefined && timeoutMs !== null && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (pendingReader && pendingReader.resolve === resolve) {
            pendingReader = null;
            reject(new HardwareTimeoutError(`no response received within ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }

      pendingReader = { resolve, reject, timer };
    });
  }

  function flushInput() {
    // Drop stale unread device lines (late acks from a previously timed-out
    // command, boot banners that arrived after the boot-delay window, etc.)
    // so the next issued command can only ever read its own acknowledgement.
    lineQueue.length = 0;
  }

  async function close() {
    if (!isOpen || !port) {
      return;
    }
    isOpen = false;
    if (pendingReader) {
      if (pendingReader.timer) clearTimeout(pendingReader.timer);
      pendingReader.reject(new HardwareUnavailableError('serial port closed while waiting for response'));
      pendingReader = null;
    }
    await new Promise((resolve) => {
      port.close(() => {
        port = null;
        resolve();
      });
    });
  }

  return {
    open,
    writeLine,
    readLine,
    flushInput,
    close,
    get isOpen() {
      return isOpen && port && port.isOpen;
    },
  };
}

module.exports = {
  createSerialTransport,
  autoDetectPort,
};
