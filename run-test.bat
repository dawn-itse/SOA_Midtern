@echo off
rem Chạy 1 bộ test trong cửa sổ riêng. Được gọi bởi start-all.bat:
rem   run-test.bat <số thứ tự> <tiêu đề cửa sổ> <file test>
rem Các bộ test dùng chung dữ liệu mẫu (ACC001, ACC003, các FEE-...) nên chạy TUẦN TỰ:
rem bộ N chờ file N-1.done do bộ N-1 tạo ra khi xong.
chcp 65001 >nul
setlocal EnableDelayedExpansion
set "N=%~1"
set "MK=%TEMP%\ibanking_tests"
title %~2
cd /d "%~dp0Backend"

rem Ghi PID của cửa sổ cmd này để stop-all.bat đóng được đúng cửa sổ
for /f "usebackq" %%P in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId"`) do >"%MK%\%N%.pid" echo %%P

if "%N%"=="1" goto :run
set /a PREV=N-1
echo [%~2] Đang chờ bộ test trước đó chạy xong (các bộ test dùng chung dữ liệu mẫu nên chạy tuần tự)...
:wait
if exist "%MK%\!PREV!.done" goto :run
timeout /t 2 /nobreak >nul
goto :wait

:run
echo.
echo ============================================================
echo   %~2  -  node %~3
echo ============================================================
node %~3
set "RC=!errorlevel!"
>"%MK%\%N%.done" echo done
echo.
echo ============================================================
if "!RC!"=="0" (echo   KẾT QUẢ: PASS) else (echo   KẾT QUẢ: FAIL - mã thoát !RC!)
echo   Cửa sổ này sẽ được đóng khi chạy stop-all.bat
echo ============================================================
title %~2
endlocal
