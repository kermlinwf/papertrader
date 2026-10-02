@echo off
setlocal
cd /d "%~dp0"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"

netsh advfirewall firewall show rule name="VELA paper desk" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="VELA paper desk" dir=in action=allow protocol=TCP localport=%PORT% profile=private >nul 2>&1

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
set "UP=%errorlevel%"
call :urls
if "%UP%"=="0" (
  start "" "%URL%"
  echo The desk is already running. Close this window after you copy the iPhone address.
  pause
  exit /b 0
)

where py >nul 2>&1 && (set "PY=py") || (set "PY=python")
%PY% -c "import sys" >nul 2>&1
if errorlevel 1 (
  echo Python was not found.
  echo Install Python from https://www.python.org/downloads/ and check "Add python.exe to PATH".
  pause
  exit /b 1
)

echo Starting the desk...
start "VELA paper desk" %PY% -m http.server %PORT% --bind 0.0.0.0

set /a TRIES=0
:wait
set /a TRIES+=1
if %TRIES% GTR 20 (
  echo The server did not start. Look at the "VELA paper desk" window.
  pause
  exit /b 1
)
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if errorlevel 1 (
  ping -n 2 127.0.0.1 >nul
  goto wait
)

start "" "%URL%"
echo Close this window when you have the iPhone address.
echo Close the "VELA paper desk" window to stop the server.
pause
exit /b 0

:urls
echo.
echo This computer: %URL%
echo.
echo iPhone, same Wi-Fi:
set "FOUND="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=* delims= " %%B in ("%%A") do (
    echo %%B | findstr /B "127." >nul
    if errorlevel 1 (
      echo   http://%%B:%PORT%/
      set "FOUND=1"
    )
  )
)
if not defined FOUND echo   No Wi-Fi address yet. Connect this PC to the same network as the phone.
echo.
echo If the phone cannot open it, allow Python on private networks in Windows Firewall.
echo.
exit /b 0
