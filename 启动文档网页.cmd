@echo off
chcp 65001 >nul
cd /d "%~dp0web"

if not exist "node_modules\" (
  echo 正在安装网页运行组件，请稍候...
  call npm install
  if errorlevel 1 goto :error
)

echo.
echo 文档网页即将启动，请在浏览器打开 http://localhost:3000/
echo 关闭本窗口即可停止网页。
echo.
call npm run dev
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo 启动失败，请确认已安装 Node.js 22 或更新版本。
pause
exit /b 1
