@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-test\.bat' -and $_.ProcessId -ne $PID } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }"
if exist "%TEMP%\ibanking_tests" rd /s /q "%TEMP%\ibanking_tests" >nul 2>&1
