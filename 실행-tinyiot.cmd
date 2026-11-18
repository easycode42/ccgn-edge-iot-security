@echo off
cd /d "%~dp0"
wsl --cd "%~dp0." -- bash tools/ccgn_wsl.sh run
if errorlevel 1 pause
