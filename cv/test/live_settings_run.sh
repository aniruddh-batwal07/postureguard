#!/usr/bin/env bash
# Live M3.3 probe: starts the real backend, runs the CV-settings live probe,
# then stops the backend. Run as a single WSL session so the backend stays alive.
set -u
export PATH=/home/aniruddh/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin

cd ~/projects/postureguard/backend || exit 10
nohup env HOST=0.0.0.0 node src/app.js >/tmp/pg-backend.log 2>&1 </dev/null &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null' EXIT

for i in $(seq 1 20); do
  if ss -tln | grep -q ':4000'; then break; fi
  sleep 0.5
done
if ! ss -tln | grep -q ':4000'; then
  echo "backend did not start:"; cat /tmp/pg-backend.log; exit 11
fi
echo "[live] backend listening; starting probe"

cd ~/projects/postureguard/cv || exit 12
.venv/bin/python test/live_settings_probe.py
RC=$?

kill $BACKEND_PID 2>/dev/null
wait $BACKEND_PID 2>/dev/null
echo "[live] backend stopped"
exit $RC