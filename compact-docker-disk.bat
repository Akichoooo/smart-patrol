@echo off
setlocal
echo ===== Docker vhdx diagnostic + compact =====
echo.
set "VHD=D:\Docker Project\DockerDesktopWSL\disk\docker_data.vhdx"
set "SCRIPT=%TEMP%\dp_diag.txt"
set "OUT=%TEMP%\dp_out.txt"
echo.
echo [1] Current file size:
powershell -NoProfile -Command "$f=Get-Item '%VHD%'; Write-Host ([math]::Round($f.Length/1GB,2)) GB"
echo.
echo [2] Quit Docker Desktop now if you have not.
echo [3] Press any key, then click YES on the UAC window.
pause >nul

echo select vdisk file="%VHD%" > "%SCRIPT%"
echo detail vdisk >> "%SCRIPT%"
echo attach vdisk readonly >> "%SCRIPT%"
echo compact vdisk >> "%SCRIPT%"
echo detach vdisk >> "%SCRIPT%"
echo exit >> "%SCRIPT%"

powershell -NoProfile -Command "$p = Start-Process diskpart -ArgumentList '/s','%SCRIPT%' -Verb RunAs -Wait -PassThru -RedirectStandardOutput '%OUT%'; Write-Host ('diskpart exit code: ' + $p.ExitCode)"
echo.
echo ===== diskpart output =====
if exist "%OUT%" (type "%OUT%") else (echo NO OUTPUT - UAC was declined)
echo.
echo [4] New file size:
powershell -NoProfile -Command "$f=Get-Item '%VHD%'; Write-Host ([math]::Round($f.Length/1GB,2)) GB"
echo.
del "%SCRIPT%" "%OUT%" 2>nul
echo Done. Now start Docker Desktop.
pause
