@echo off
setlocal
echo =======================================================
echo          Starting PostureGuard Full Stack
echo =======================================================
echo Starting Backend in new window...
start "PostureGuard Backend" cmd /k "cd /d %~dp0backend && npm run dev"

echo Starting Web Dashboard in new window...
start "PostureGuard Web" cmd /k "cd /d %~dp0web && npm run dev"

echo Starting Computer Vision Pipeline in new window...
start "PostureGuard CV" cmd /k "cd /d %~dp0 && call run_cv.bat"

echo.
echo All services launched!
echo - Web Dashboard: http://localhost:5173
echo - Backend API:   http://localhost:4000
echo - Hardware:      COM13 (Arduino Uno)
echo.
endlocal
