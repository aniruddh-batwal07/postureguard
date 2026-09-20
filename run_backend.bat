@echo off
setlocal
cd /d "%~dp0backend"
echo Starting PostureGuard Backend on port 4000...
npm run dev
endlocal
