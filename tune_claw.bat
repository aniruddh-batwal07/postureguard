@echo off
setlocal
title PostureGuard - Tune Claw
python "%~dp0interactive_claw_tuner.py"
pause
endlocal
