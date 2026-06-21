@echo off
REM Unbored launcher for Windows — double-click or run `start`.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py run.py %*
) else (
  python run.py %*
)
