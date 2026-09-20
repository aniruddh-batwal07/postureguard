@echo off
setlocal
cd /d "%~dp0web"
echo Starting PostureGuard Web Dashboard on http://localhost:5173...
npm run dev
endlocal
