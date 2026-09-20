@echo off
setlocal
echo =======================================================
echo          Starting PostureGuard Full Stack
echo =======================================================
echo Starting Backend in new window...
start "PostureGuard Backend" cmd /k "cd /d %~dp0backend && npm run dev"

echo Starting Web Dashboard in new window...
start "PostureGuard Web" cmd /k "cd /d %~dp0web && npm run dev"

timeout /t 3 /nobreak >nul

echo Opening browser at http://localhost:5173 ...
start http://localhost:5173

echo.
echo Services launched!
echo - Web Dashboard: http://localhost:5173
echo - Backend API:   http://localhost:4000
echo - Hardware:      COM13 (Arduino Uno)
echo.
echo OpenCV camera pipeline will start automatically when you click "Start Session" in the Web UI.
echo.
endlocal
