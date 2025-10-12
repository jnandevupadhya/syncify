@echo off
:: ===============================
:: Check for admin rights
:: ===============================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)
setlocal enabledelayedexpansion
set PSERR=0
powershell -NoProfile -Command "try { exit 0 } catch { exit 1 }"
if %errorlevel% neq 0 set PSERR=1


echo Running with admin privileges!

:: ===============================
:: Step 0: Script Directory
:: ===============================
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"
echo Script is running from: %SCRIPT_DIR%

:: ===============================
:: Step 1: Check Python
:: ===============================
set NEED_PYTHON_INSTALL=0

python --version >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Python not found.
    set NEED_PYTHON_INSTALL=1
) else (
    for /f "tokens=2 delims= " %%a in ('python --version 2^>nul') do set PYVER=%%a
    echo Python found: !PYVER!

    :: Split version into major.minor.patch
    for /f "tokens=1,2,3 delims=." %%i in ("!PYVER!") do (
        set PY_MAJOR=%%i
        set PY_MINOR=%%j
        set PY_PATCH=%%k
    )

    :: Check if Python < 3.10
    if !PY_MAJOR! LSS 3 (
        set NEED_PYTHON_INSTALL=1
    ) else if !PY_MAJOR! EQU 3 if !PY_MINOR! LSS 10 (
        set NEED_PYTHON_INSTALL=1
    )
)

:: ===============================
:: Step 2: Download & Install if Needed
:: ===============================
if !NEED_PYTHON_INSTALL! EQU 1 (
    echo Python missing or too old. Downloading Python 3.13...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.13.0/python-3.13.0-amd64.exe' -OutFile 'python_installer.exe'"

    echo Installing Python 3.13 silently...
call python_installer.exe /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1

set "PATH=C:\Users\smask\AppData\Local\Programs\Python\Python313;%PATH%"
    python --version >nul 2>&1
    if %errorlevel% NEQ 0 (
        echo Python installed, please re-run the setup.
del /f /q python_installer.exe
        pause
        exit /b 1
    ) else (
for /f "tokens=2 delims= " %%a in ('python --version 2^>nul') do (
    set NEW_PYVER=%%a
)

echo Python installed: !NEW_PYVER!
    )

    echo Cleaning up installer...
    del /f /q python_installer.exe
) else (
    echo Python is new enough. No installation needed.
)



:: ===============================
:: Step 2: Check pip
:: ===============================
pip --version >nul 2>&1
if %errorlevel% NEQ 0 (
    echo pip not found. Installing ensurepip...
    python -m ensurepip --upgrade
    if %errorlevel% NEQ 0 (
        echo Failed to install pip. Please install manually.
        exit /b
    )
) else (
    echo pip found:
    pip --version
)

:: ===============================
:: Step 3: Create virtual environment
:: ===============================
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
) else (
    echo Virtual environment already exists.
)

:: ===============================
:: Step 4: Activate venv
:: ===============================
call venv\Scripts\activate

:: ===============================
:: Step 5: Install Python dependencies
:: ===============================
if exist requirements.txt (
    echo Installing dependencies...
    pip install --upgrade pip
    pip install -r requirements.txt
) else (
    echo No requirements.txt found, skipping dependencies.
)

:: ==========================
:: Prepare bin folder & add Defender exclusion (must be admin)
:: ==========================
set SCRIPT_DIR=%~dp0
set BIN_DIR=%SCRIPT_DIR%bin\cloudflared
if not exist "%BIN_DIR%" (
  mkdir "%BIN_DIR%"
)

echo Adding Windows Defender exclusion for folder "%BIN_DIR%"...
powershell -NoProfile -Command ^
  "Try { Add-MpPreference -ExclusionPath '%BIN_DIR%'; Write-Output 'EXCLUSION_OK' } Catch { Write-Output 'EXCLUSION_FAILED'; exit 1 }" > "%TEMP%\cloudflared_excl_out.txt" 2>&1

for /f "usebackq delims=" %%A in ("%TEMP%\cloudflared_excl_out.txt") do set EXCL_RESULT=%%A

if "%EXCL_RESULT%"=="EXCLUSION_OK" (
  echo Defender exclusion added for %BIN_DIR%.
) else (
  echo Warning: Could not add Defender exclusion for %BIN_DIR%.
  echo This may be due to lack of privileges or group policy. The download may still be quarantined.
  echo You can try manually adding an exclusion or restore from Protection history if quarantined.
)

:: ==========================
:: Download into the excluded folder
:: ==========================
set DEST=%BIN_DIR%\cloudflared.exe
set DOWNLOAD_URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe

if exist "%DEST%" (
  echo cloudflared already present at %DEST%
  goto :CF_DONE
)

echo Downloading cloudflared to %DEST%...
:: after download line
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%DEST%' -UseBasicParsing" || (
  echo Download failed or interrupted. & exit /b 1
)


:: Give Windows a moment to finish any post-download/security handling
echo Waiting briefly to allow Windows security to settle...
timeout /t 1 >nul


echo cloudflared downloaded, unblocked, and verified at %DEST%
goto :CF_DONE
:CF_DONE


:: ===============================
:: Step 7: Firewall rule
:: ===============================
netsh advfirewall firewall add rule name="FastAPI" dir=in action=allow protocol=TCP localport=8000

:: ===============================
:: Step 8: Start Python backend
:: ===============================
REM replace test.py with your actual entrypoint (e.g., run_server.py or start script)
cls
call python setup_helper_do_not_run_manually.py

