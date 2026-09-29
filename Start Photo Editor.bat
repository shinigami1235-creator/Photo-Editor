@echo off
title Photo Editor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and open this file again.
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust is not installed. Install it from https://rustup.rs and open this file again.
  pause
  exit /b 1
)

echo Updating the editor's parts. The first time takes a few minutes.
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed. Send Claude a screenshot of this window.
  pause
  exit /b 1
)

echo Starting the editor. The first start compiles the app and takes several minutes.
call npm run tauri dev
if errorlevel 1 (
  echo The editor stopped with an error. Send Claude a screenshot of this window.
  pause
)
