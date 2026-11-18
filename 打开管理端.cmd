@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is required to start the local manager.
  pause
  exit /b 1
)
if not exist "%LOCALAPPDATA%\XinhuoNotes\admin.json" (
  powershell -NoProfile -Command "$env:XINHUO_ADMIN_USER=Read-Host 'Manager username'; $secret=Read-Host 'Manager password' -AsSecureString; $env:XINHUO_ADMIN_PASSWORD=[System.Net.NetworkCredential]::new('', $secret).Password; node tools/admin-settings.mjs"
  if errorlevel 1 exit /b 1
)
node tools/manage.mjs --open
pause
