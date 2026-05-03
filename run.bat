@echo off
set PATH=%~dp0node\node-v20.11.0-win-x64;%PATH%
cd /d %~dp0
npm run dev
pause