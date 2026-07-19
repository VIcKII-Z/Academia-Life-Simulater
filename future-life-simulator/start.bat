@echo off
setlocal

cd /d "%~dp0"

echo Starting Future Life Simulator...
echo.

if not exist "backend\package.json" (
  echo [ERROR] backend\package.json not found. Please run this script from future-life-simulator.
  pause
  exit /b 1
)

if not exist "frontend\package.json" (
  echo [ERROR] frontend\package.json not found. Please run this script from future-life-simulator.
  pause
  exit /b 1
)

if not exist "backend\node_modules" (
  echo Installing backend dependencies...
  pushd backend
  call npm ci
  if errorlevel 1 (
    echo [ERROR] Backend dependency install failed.
    pause
    exit /b 1
  )
  popd
)

if not exist "frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd frontend
  call npm ci
  if errorlevel 1 (
    echo [ERROR] Frontend dependency install failed.
    pause
    exit /b 1
  )
  popd
)

start "Future Life Simulator Backend" /D "%~dp0backend" cmd /k "npm run dev"
start "Future Life Simulator Frontend" /D "%~dp0frontend" cmd /k "npm run dev"

echo.
echo Backend:  http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Waiting for the frontend to start...
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
echo.
echo Two terminal windows have been opened. Use the Shutdown Demo button or close them to stop the servers.
pause
