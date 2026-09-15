@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

rem ============================================================
rem Hybrid deployment: the WVP jar runs natively on Windows so the
rem SIP stack binds the real NIC, while MySQL / Redis / ZLM / nginx
rem stay in Docker.
rem
rem Start order:
rem   1) Docker side -- do NOT start polaris-wvp, it would grab 5060
rem      docker compose -f docker/docker-compose.yml up -d polaris-mysql polaris-redis polaris-media yolo-service
rem      docker compose -f docker/docker-compose.yml up -d --no-deps polaris-nginx
rem   2) Then run this script to start the native jar.
rem
rem Prereq: web-react "npm run build"  +  "mvn -DskipTests package"
rem ============================================================

set "JAVA_HOME=D:\devloop\jdk 21 LTS"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo [X] JAVA_HOME invalid: %JAVA_HOME%
  pause
  exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%PATH%"

rem --- Do NOT set RUN_ENV=docker: native SIP must use the real NIC ---
set DATABASE_HOST=127.0.0.1
set DATABASE_PORT=33061
set DATABASE_USER=wvp_user
set DATABASE_PASSWORD=wvp_password
set REDIS_HOST=127.0.0.1
set REDIS_PORT=16379
set ZLM_HOST=127.0.0.1
set ZLM_SERCERT=su6TiedN2rVAmBbIDX0aa0QTiBJLBdcf
set ZLM_HOOK_HOST=host.docker.internal
set MediaHttp=8081
set MediaRtmp=10001
set MediaRtsp=10002
set MediaRtp=10003
rem Stream_IP = host used in playback URLs returned to the BROWSER.
rem Docker(WSL2 mirrored) published ports are reachable only via 127.0.0.1 on
rem this host -- a physical-NIC IP times out (black screen for channels that
rem used to play). SDP_IP is the device-facing receive address and MUST stay on
rem the real NIC. The two are independent: never change them together.
set Stream_IP=127.0.0.1
set SDP_IP=192.168.0.100
set SIP_IP=192.168.0.100
set SIP_ShowIP=192.168.0.100
set SIP_Port=5060
set SIP_Domain=3402000000
set SIP_Id=34020000002000000001
set SIP_Password=admin12345
set RecordSip=true
set RecordPushLive=
set YOLO_URL=http://127.0.0.1:8999
set PATROL_CAPTURE_ZLM_API_URL=http://127.0.0.1:8081
set "PATROL_MEDIA_UPLOADDIR=D:/Docker Project/wvp-GB28181-pro/docker/volumes/patrol-media"

rem --- Resolve the built jar (java -jar does NOT expand wildcards) ---
set "JAR="
for %%f in ("target\wvp-pro-*.jar") do set "JAR=%%~ff"
if not defined JAR (
  echo [X] Jar not found under target\wvp-pro-*.jar
  echo     Build it first:  mvn -DskipTests package
  pause
  exit /b 1
)

echo [*] Starting WVP from: %JAR%
echo.
java -Xms512m -Xmx1024m -XX:+HeapDumpOnOutOfMemoryError -jar "%JAR%" --spring.config.location=file:docker/wvp/wvp/application-docker.yml

echo.
echo [X] WVP exited, code=%ERRORLEVEL%
pause
