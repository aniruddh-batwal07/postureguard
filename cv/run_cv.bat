@echo off
setlocal
cd /d "%~dp0"

set "PYTHONPATH=%~dp0src;%PYTHONPATH%"
set "TMP=%~dp0.tmp"
set "TEMP=%~dp0.tmp"
set "MPLCONFIGDIR=%~dp0.matplotlib"

if not exist "%TMP%" mkdir "%TMP%"
if not exist "%MPLCONFIGDIR%" mkdir "%MPLCONFIGDIR%"

if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" -m cv %*
    goto :done
)

where uv >nul 2>&1
if %errorlevel% equ 0 (
    uv run python -m cv %*
    goto :done
)

if exist "C:\Users\91845\AppData\Local\hermes\bin\uv.exe" (
    "C:\Users\91845\AppData\Local\hermes\bin\uv.exe" run python -m cv %*
    goto :done
)

python -m cv %*

:done
echo.
echo [cv] Process finished (exit code %errorlevel%).
echo Press any key to close this window...
pause >nul
endlocal
