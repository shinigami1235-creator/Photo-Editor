@echo off
title Build Photo Editor
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

echo Building the app. Close the editor first if it is open. This takes 5 to 15 minutes the first time.
call npm run tauri build
if errorlevel 1 (
  echo The build failed. Send Claude a screenshot of this window.
  pause
  exit /b 1
)

echo Done. photo-editor.exe is in src-tauri\target\release and the installer is in src-tauri\target\release\bundle\nsis.
explorer "src-tauri\target\release"
pause
