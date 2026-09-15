@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "VHDX=D:\Docker Project\DockerDesktopWSL\disk\docker_data.vhdx"

echo ============================================================
echo  Docker 数据盘锁修复
echo  现象: docker_data.vhdx 被 Windows 残留挂载，Docker 启动报
echo        Wsl/Service/AttachDisk/MountDisk/HCS/ERROR_SHARING_VIOLATION
echo  动作: 退出 Docker Desktop -^> 分离 vdisk -^> 重新启动 Docker
echo ============================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [X] 需要管理员权限。
  echo     请右键本文件 -^> "以管理员身份运行"。
  echo.
  pause
  exit /b 1
)
echo [OK] 管理员权限已获取
echo.

echo [1/5] 退出 Docker Desktop ...
taskkill /F /IM "Docker Desktop.exe" >nul 2>&1
taskkill /F /IM "com.docker.backend.exe" >nul 2>&1
taskkill /F /IM "com.docker.build.exe" >nul 2>&1
timeout /t 5 /nobreak >nul

echo [2/5] 关闭 WSL 释放句柄 ...
wsl.exe --shutdown >nul 2>&1
timeout /t 5 /nobreak >nul

echo [3/5] 分离残留挂载的 vdisk ...
set "DPSCRIPT=%TEMP%\detach_docker_vhdx.txt"
> "%DPSCRIPT%" echo select vdisk file="%VHDX%"
>>"%DPSCRIPT%" echo detach vdisk
>>"%DPSCRIPT%" echo exit
diskpart /s "%DPSCRIPT%"
del /q "%DPSCRIPT%" >nul 2>&1
echo.

echo [4/5] 校验是否仍被挂载 ...
powershell -NoProfile -Command "$d = Get-Disk | Where-Object { $_.Location -like '*docker_data.vhdx*' }; if ($d) { Write-Host ('[X] 仍被挂载: Disk ' + $d.Number) } else { Write-Host '[OK] 已分离，不再被 Windows 占用' }"
echo.

echo [5/5] 重新启动 Docker Desktop ...
if exist "D:\devloop\Docker\frontend\Docker Desktop.exe" (
  start "" "D:\devloop\Docker\frontend\Docker Desktop.exe"
  echo [OK] 已拉起 Docker Desktop，等待约 30-60 秒引擎就绪
) else (
  echo [X] 未找到 Docker Desktop.exe，请手动启动
)
echo.
echo 完成后回到 ZCode 告诉我，我继续启动平台容器。
pause
