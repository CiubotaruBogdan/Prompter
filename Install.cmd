@echo off
setlocal
if not exist "%~dp0windows\PrompturiHost.exe" (
    echo Run Build-Windows.ps1 with PowerShell 7 to build the Windows helper.
    pause
    exit /b 1
)
"%~dp0windows\PrompturiHost.exe" --install
if errorlevel 1 (
    echo Could not install the Windows helper.
    pause
    exit /b 1
)
echo Windows helper installed for this user.
echo In Chrome, open chrome://extensions and select the "extensie" folder with Load unpacked.
pause
