@echo off
chcp 65001 >nul
title 智学伴读 · 本地直读工作台
echo ========================================================
echo   🚀 正在启动 智学伴读 · 本地直读工作台...
echo   📖 书库源: D:\OneDrive - SkyMan\个人文件\我的文档\我的电子书
echo   📝 读后库: D:\Remotely-save\读后
echo   🎓 学习库: D:\Remotely-save\学习\学习库
echo ========================================================
echo.
cd /d "%~dp0\tools\local-study"
start http://127.0.0.1:3721
node server.js
pause
