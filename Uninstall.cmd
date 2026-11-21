@echo off
setlocal
"%~dp0windows\PrompturiHost.exe" --uninstall
if errorlevel 1 (
    echo Could not uninstall the Windows helper.
    pause
    exit /b 1
)
echo Windows helper uninstalled.
pause
