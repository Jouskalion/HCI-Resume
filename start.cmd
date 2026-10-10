@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer, then run this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist node_modules\express (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:3000 in your browser.
call npm.cmd start
pause
