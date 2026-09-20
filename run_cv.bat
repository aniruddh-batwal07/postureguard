@echo off
setlocal
cd /d "%~dp0cv"
call run_cv.bat %*
endlocal
