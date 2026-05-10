@echo off
echo Killing process on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo Starting server...
start "Calorie Tracker" /min cmd /c "cd /d %~dp0 && node server.js"
timeout /t 2 /nobreak >nul
echo Server running at http://localhost:3000
pause
