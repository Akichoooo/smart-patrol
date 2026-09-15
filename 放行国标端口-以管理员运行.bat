@echo off
chcp 65001 >nul
echo 正在为 WVP 国标视频接入放行 Windows 防火墙规则...
netsh advfirewall firewall add rule name="WVP_SIP_5060_UDP" dir=in action=allow protocol=UDP localport=5060
netsh advfirewall firewall add rule name="WVP_SIP_5060_TCP" dir=in action=allow protocol=TCP localport=5060
netsh advfirewall firewall add rule name="WVP_RTP_10000-10010" dir=in action=allow protocol=UDP localport=10000-10010
netsh advfirewall firewall add rule name="WVP_ZLM_8081" dir=in action=allow protocol=TCP localport=8081
echo.
echo ========================================================
echo [OK] 防火墙入站规则已成功添加！
echo 端口 5060 (SIP信令) 与 10000-10010 (视频流RTP) 已全部放行！
echo.
echo 请回到海康摄像机配置页面，再次点击底部的【保存】按钮。
echo ========================================================
pause
