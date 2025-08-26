@echo off
setlocal

REM Change to the directory of this script
cd /d "%~dp0"

REM Check if Node.js is installed and on PATH
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Node.js is not installed or not on PATH.
  echo         Install Node.js LTS (>= 18) from https://nodejs.org/ and then reopen your terminal.
  echo.
  pause
  exit /b 1
)

REM Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo Installing dependencies...
  npm install
  if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] npm install failed.
    echo.
    pause
    exit /b 1
  )
)

REM Start the server
echo Starting server...
npm start

endlocal
