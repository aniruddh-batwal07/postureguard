@echo off
setlocal
title PostureGuard - Flash Firmware
echo ================================================================
echo           PostureGuard - Arduino Firmware Flasher
echo ================================================================
echo.
echo Closing any backend processes holding COM13...
taskkill /F /FI "WINDOWTITLE eq PostureGuard Backend*" /T >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo Flashing calibrated firmware (firmware.hex) to Arduino Uno...
python "%~dp0firmware\flash_firmware.py"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ================================================================
    echo Firmware successfully flashed!
    echo Now verifying gripper claw (OPEN to 30 deg, CLOSE to -25 deg)...
    echo ================================================================
    python "%~dp0test_calibrated_gripper.py"
) else (
    echo.
    echo [!] Flashing failed. Please ensure Arduino Uno is plugged in on COM13.
)

pause
endlocal
