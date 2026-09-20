'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn, exec } = require('node:child_process');

function createCvManager({ rootDir = path.resolve(__dirname, '../../..') } = {}) {
  let cvProcess = null;
  let isStarting = false;

  const cvDir = path.resolve(rootDir, 'cv');
  const venvPython = path.resolve(cvDir, '.venv', 'Scripts', 'python.exe');
  const pythonExecutable = fs.existsSync(venvPython) ? venvPython : 'python';

  function status() {
    const running = Boolean(cvProcess && !cvProcess.killed && cvProcess.exitCode === null);
    return {
      running,
      pid: running ? cvProcess.pid : null,
    };
  }

  async function start({ noPreview = false } = {}) {
    if (status().running || isStarting) {
      return status();
    }
    isStarting = true;

    try {
      const args = ['-m', 'cv'];
      if (noPreview) {
        args.push('--no-preview');
      }

      console.log(`[cv-manager] starting CV process: ${pythonExecutable} ${args.join(' ')}`);

      const env = {
        ...process.env,
        PYTHONPATH: path.resolve(cvDir, 'src'),
        MPLCONFIGDIR: path.resolve(cvDir, '.matplotlib'),
        TMP: path.resolve(cvDir, '.tmp'),
        TEMP: path.resolve(cvDir, '.tmp'),
      };

      const child = spawn(pythonExecutable, args, {
        cwd: cvDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      });

      cvProcess = child;

      child.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          console.log(`[cv] ${text}`);
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          console.error(`[cv:err] ${text}`);
        }
      });

      child.on('error', (err) => {
        console.error(`[cv-manager] failed to start CV: ${err.message}`);
        cvProcess = null;
      });

      child.on('exit', (code, signal) => {
        console.log(`[cv-manager] CV process exited with code ${code}, signal ${signal}`);
        cvProcess = null;
      });

      return {
        running: true,
        pid: child.pid,
      };
    } finally {
      isStarting = false;
    }
  }

  async function stop() {
    if (!cvProcess) {
      return { running: false };
    }

    const pid = cvProcess.pid;
    console.log(`[cv-manager] stopping CV process (pid ${pid})...`);

    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${pid} /T /F`, (err) => {
          if (err) {
            console.warn(`[cv-manager] taskkill warning: ${err.message}`);
          }
          cvProcess = null;
          resolve({ running: false });
        });
      } else {
        try {
          cvProcess.kill('SIGTERM');
        } catch {}
        cvProcess = null;
        resolve({ running: false });
      }
    });
  }

  return {
    start,
    stop,
    status,
  };
}

module.exports = {
  createCvManager,
};
