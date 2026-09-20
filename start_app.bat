@echo off
setlocal
title PostureGuard App Launcher

echo ================================================================
echo                   PostureGuard Launcher
echo ================================================================
echo.
echo Starting Backend and Web servers...
echo (OpenCV and camera pipeline start automatically from the Web UI)
echo.

:: Start Backend server
start "PostureGuard Backend" cmd /k "cd /d %~dp0backend && npm run dev"

:: Start Web dashboard
start "PostureGuard Web" cmd /k "cd /d %~dp0web && npm run dev"

:: Wait a brief moment for servers to spin up
timeout /t 3 /nobreak >nul

:: Launch browser directly to the dashboard
echo Opening PostureGuard in your default web browser...
start http://localhost:5173

echo.
echo ================================================================
echo PostureGuard is live!
echo.
echo - Web Dashboard:  http://localhost:5173
echo - Backend API:    http://localhost:4000
echo - Hardware Port:  COM13 (Arduino Uno)
echo.
echo You can now manage everything from your browser:
echo 1. Click "Start Session" to automatically launch the CV pipeline.
echo 2. Baseline is calibrated once and saved in browser storage.
echo 3. Click "End Session" to stop CV and safely dock the arm.
echo ================================================================
echo.
pause
endlocal
