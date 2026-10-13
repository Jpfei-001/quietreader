@echo off
setlocal
echo Quiet Reader packaging - release version is checked before building.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Build-Windows.ps1" %*
set "build_exit=%errorlevel%"
if not "%build_exit%"=="0" (
  echo.
  echo Windows packaging failed. See the error above; existing books and notes were not cleared.
) else (
  echo.
  echo Packaging/check completed. See the output above for the version and release folder.
)
pause
exit /b %build_exit%
