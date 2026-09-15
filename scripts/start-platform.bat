@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

rem ============================================================
rem One-click start for the inspection platform (hybrid mode).
rem
rem   Docker side : mysql, redis, zlm media, yolo, nginx
rem   Native side : WVP jar (SIP needs the real NIC, so it cannot
rem                 live in the container in this deployment)
rem
rem polaris-wvp is guarded by a compose profile, so "docker compose up"
rem never creates it and never fights the native jar for 5060.
rem ============================================================

set "DOCKER_DESKTOP=D:\devloop\Docker\frontend\Docker Desktop.exe"
set "COMPOSE=docker compose -f docker/docker-compose.yml"

rem ---------- 1) make sure the Docker engine is up ----------
docker info >nul 2>&1
if not errorlevel 1 goto engine_ok

echo [*] Docker engine is not running, starting Docker Desktop ...
if exist "%DOCKER_DESKTOP%" start "" "%DOCKER_DESKTOP%"
set /a tries=0

:wait_engine
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto engine_ok
set /a tries+=1
echo     waiting for the engine ... %tries%/36
if %tries% lss 36 goto wait_engine
echo [X] Docker engine did not become ready within 3 minutes.
echo     If it keeps failing, run scripts\fix-docker-vhdx-lock.bat as Administrator
echo     (the data disk can stay attached to Windows and block WSL).
pause
exit /b 1

:engine_ok
echo [OK] Docker engine ready

rem ---------- 2) start the middleware containers ----------
echo [*] Starting containers (mysql / redis / media / yolo / nginx) ...
%COMPOSE% up -d --wait --wait-timeout 300 polaris-mysql polaris-redis polaris-media yolo-service polaris-nginx
if errorlevel 1 (
  echo [X] "compose up" failed. See the output above.
  pause
  exit /b 1
)
echo [OK] Containers are up and healthy

rem ---------- 3) start the native WVP jar ----------
rem The jar keeps running in this window; its log is the console output.
echo [*] Starting the native WVP jar ...
call "%~dp0start-wvp-local.bat"
