@echo off
chcp 65001 >nul
setlocal
title 静读 - 本地 EPUB 阅读器
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 22.12 或更新的 LTS 版本。
  echo 安装地址：https://nodejs.org/
  goto failed
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a<22||(a===22&&b<12)?1:0)"
if errorlevel 1 (
  echo Node.js 版本过低，需要 22.12 或以上版本。
  goto failed
)
where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm，请检查 Node.js 安装和 PATH。
  goto failed
)
node -e "const fs=require('fs'),c=require('crypto');let ok=false;try{const m=JSON.parse(fs.readFileSync('node_modules/.quiet-reader-windows','utf8'));ok=m.platform===process.platform&&m.hash===c.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex')}catch{}process.exit(ok?0:1)"
if errorlevel 1 (
  echo 首次启动或依赖已更新，正在安装对应平台依赖；此步骤需要联网。
  call npm ci
  if errorlevel 1 goto failed
  node -e "const fs=require('fs'),c=require('crypto');fs.writeFileSync('node_modules/.quiet-reader-windows',JSON.stringify({platform:process.platform,hash:c.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex')}))"
  if errorlevel 1 goto failed
)
echo.
echo 静读地址：http://127.0.0.1:1420
echo 正在打开浏览器。请保留此窗口；退出使用 Ctrl+C。
echo 书架保存在当前浏览器，请不要清理该站点的数据。
call npm run dev -- --open
if errorlevel 1 goto failed
popd
exit /b 0
:failed
echo.
echo 启动失败。请根据上方错误检查环境，更多说明见 README.md。
pause
popd
exit /b 1
