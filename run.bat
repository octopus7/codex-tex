@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo Starting Codex Tex...
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Codex Tex exited with code %EXIT_CODE%.
) else (
  echo Codex Tex has closed.
)

pause
exit /b %EXIT_CODE%
