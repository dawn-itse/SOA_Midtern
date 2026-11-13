@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="__run_test" goto :sub_run_test
if "%~1"=="__kill_tests" goto :sub_kill_tests
if /i "%~1"=="stop" goto :sub_stop

echo ============================================================
echo   TDTU iBanking - Quản lý hệ thống (Docker Compose)
echo ============================================================
echo.

rem ---------- 1. Kiểm tra Docker ----------
docker --version >nul 2>&1
if errorlevel 1 (
  echo [LỖI] Chưa cài Docker Desktop.
  echo   Tải và cài đặt tại: https://www.docker.com/products/docker-desktop/
  echo   Sau khi cài xong, mở Docker Desktop rồi chạy lại file này.
  start "" "https://www.docker.com/products/docker-desktop/"
  pause
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo [LỖI] Docker Desktop chưa chạy.
  echo   Đang thử mở Docker Desktop... hãy đợi biểu tượng cá voi báo "running" rồi chạy lại file này.
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  pause
  exit /b 1
)

rem ---------- 2. Chọn chế độ ----------
echo Chọn thao tác / chế độ gửi email OTP:
echo   [1] Khởi động với Mailpit (mặc định - xem mail trên web)
echo   [2] Khởi động với Gmail thật
echo   [3] Dừng toàn bộ hệ thống (và đóng các cửa sổ test)
set "MODE=1"
set /p "MODE=Nhập 1, 2 hoặc 3 (Enter = 1): "
if "!MODE!"=="" set "MODE=1"

if "!MODE!"=="3" goto :sub_stop

set "SMTP_USER="
set "SMTP_PASS="
set "SMTP_FROM="
set "MAIL_TO_OVERRIDE="

if "!MODE!"=="2" goto :gmail

rem ---------- 3. Chế độ 1: Mailpit ----------
set "SMTP_HOST=mailpit"
set "SMTP_PORT=1025"
set "MAILINFO=Mailpit: http://localhost:8025"
goto :run

rem ---------- 4. Chế độ 2: Gmail thật ----------
:gmail
echo.
echo ---- Hướng dẫn tạo App Password cho Gmail GỬI ----
echo   1. Bật xác thực 2 bước cho tài khoản Gmail dùng để gửi.
echo   2. Mở https://myaccount.google.com/apppasswords
echo   3. Tạo mật khẩu ứng dụng (16 ký tự) và dán vào bên dưới.
echo   (App Password là của Gmail GỬI; email NHẬN OTP nhập ở bước sau)
echo.
:ask_user
set "SMTP_USER="
set /p "SMTP_USER=Gmail GỬI (SMTP_USER): "
echo !SMTP_USER! | findstr /r "@" >nul || (echo   Email không hợp lệ, nhập lại. & goto :ask_user)
:ask_pass
set "SMTP_PASS="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host 'App Password của Gmail gửi (ẩn ký tự)' -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); [Runtime.InteropServices.Marshal]::PtrToStringAuto($b)"`) do set "SMTP_PASS=%%P"
set "SMTP_PASS=!SMTP_PASS: =!"
if "!SMTP_PASS!"=="" (echo   Chưa nhập App Password, nhập lại. & goto :ask_pass)
:ask_to
set "MAIL_TO_OVERRIDE="
set /p "MAIL_TO_OVERRIDE=Email NHẬN OTP (MAIL_TO_OVERRIDE): "
echo !MAIL_TO_OVERRIDE! | findstr /r "@" >nul || (echo   Email không hợp lệ, nhập lại. & goto :ask_to)
set "SMTP_HOST=smtp.gmail.com"
set "SMTP_PORT=587"
set "MAILINFO=Mail gửi tới: !MAIL_TO_OVERRIDE!"

rem ---------- 5-6. Chạy compose ----------
:run
echo.
echo Đang build và khởi động các container (lần đầu có thể mất vài phút)...
docker compose up -d --build
if errorlevel 1 (
  echo [LỖI] docker compose thất bại. Xem thông báo phía trên.
  pause
  exit /b 1
)

echo.
echo Đang chờ các dịch vụ sẵn sàng (tối đa ~3 phút)...
set /a TRIES=0
:wait
set "NOTREADY="
for %%C in (ibanking_mysql ibanking_auth ibanking_tuition ibanking_notification ibanking_payment ibanking_gateway) do (
  set "ST="
  for /f "delims=" %%S in ('docker inspect -f "{{.State.Health.Status}}" %%C 2^>nul') do set "ST=%%S"
  if not "!ST!"=="healthy" set "NOTREADY=!NOTREADY! %%C"
)
if not defined NOTREADY goto :ready
set /a TRIES+=1
if !TRIES! GEQ 60 (
  echo [CẢNH BÁO] Hết thời gian chờ. Chưa sẵn sàng:!NOTREADY!
  echo   Xem log bằng: docker compose logs
  pause
  exit /b 1
)
echo   [!TRIES!/60] Chưa sẵn sàng:!NOTREADY!
timeout /t 3 /nobreak >nul
goto :wait

rem ---------- 7. Bảng thông tin ----------
:ready
echo.
echo ============================================================
echo   HỆ THỐNG ĐÃ SẴNG SÀNG
echo ============================================================
echo   Frontend    : http://localhost:5173
echo   API Gateway : http://localhost:8000  (frontend gọi API qua đây)
echo   Auth API    : http://localhost:8001
echo   Tuition     : http://localhost:8002
echo   Payment     : http://localhost:8003
echo   Notification: http://localhost:8004  (API nội bộ, cần x-internal-secret)
echo   Swagger UI  : http://localhost:8080  (tài liệu OpenAPI 4 service)
echo   !MAILINFO!
echo.
echo   MySQL       : host localhost, cổng 3307, user root, mật khẩu password
echo                 (user riêng: auth_user, tuition_user, payment_user, notification_user)
echo.
echo   Tài khoản demo : nguyenvana / password123, tranthib / password123
echo   MSSV mẫu       : 524H0024, 524H0129
echo.
echo   Dừng hệ thống     : chạy lại start-all.bat chọn [3] (hoặc: start-all.bat stop)
echo   Reset dữ liệu     : docker compose down -v
echo ============================================================
start "" "http://localhost:5173"
if "!MODE!"=="1" start "" "http://localhost:8025"

rem ---------- 8. Mở các cửa sổ chạy test tự động ----------
echo.
set "RUNTEST=Y"
if not "!MODE!"=="1" set "RUNTEST=N"
set /p "RUNTEST=Mở 3 cửa sổ chạy test tự động? [Y/N] (Enter = !RUNTEST!): "
if /i not "!RUNTEST!"=="Y" goto :skiptests

where node >nul 2>&1
if errorlevel 1 (
  echo [CẢNH BÁO] Chưa cài Node.js nên không chạy được test. Cài tại https://nodejs.org rồi chạy lại.
  goto :skiptests
)
if not exist "Backend\node_modules\mysql2" (
  echo Đang cài thư viện cho test - npm install...
  pushd Backend
  call npm install
  popd
)

call :sub_kill_tests
md "%TEMP%\ibanking_tests" >nul 2>&1

start "TEST-1-AUTH-TUITION" cmd /k call "%~f0" __run_test 1 TEST-1-AUTH-TUITION test-all.js
start "TEST-2-PAYMENT" cmd /k call "%~f0" __run_test 2 TEST-2-PAYMENT test-payment.js
start "TEST-3-E2E" cmd /k call "%~f0" __run_test 3 TEST-3-E2E test-e2e.js
echo Đã mở 3 cửa sổ test. Chúng chạy lần lượt 1 → 2 → 3 và sẽ được đóng khi dừng hệ thống.
:skiptests
pause
endlocal
exit /b 0

rem ============================================================
rem SUBROUTINE: Đóng các cửa sổ test
rem ============================================================
:sub_kill_tests
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '__run_test' -and $_.ProcessId -ne $PID } | ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }"
if exist "%TEMP%\ibanking_tests" rd /s /q "%TEMP%\ibanking_tests" >nul 2>&1
exit /b 0

rem ============================================================
rem SUBROUTINE: Dừng toàn bộ hệ thống Docker & đóng cửa sổ test
rem ============================================================
:sub_stop
echo.
echo [1/2] Dừng hệ thống Docker...
set "ANS=N"
set /p "ANS=Xóa luôn dữ liệu database - down -v? [y/N]: "
if /i "!ANS!"=="y" (
  docker compose -f "%~dp0docker-compose.yml" -p ibanking down -v --remove-orphans
) else (
  docker compose -f "%~dp0docker-compose.yml" -p ibanking down --remove-orphans
)
echo   docker compose kết thúc, mã thoát: !errorlevel!
echo.
echo [2/2] Đóng các cửa sổ test...
call :sub_kill_tests
echo.
echo Hoàn tất.
pause
endlocal
exit /b 0

rem ============================================================
rem SUBROUTINE: Chạy 1 bộ test tuần tự trong cửa sổ riêng
rem ============================================================
:sub_run_test
set "N=%~2"
set "TITLE=%~3"
set "TESTFILE=%~4"
set "MK=%TEMP%\ibanking_tests"
title !TITLE!
cd /d "%~dp0Backend"

for /f "usebackq" %%P in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId"`) do >"%MK%\!N!.pid" echo %%P

if "!N!"=="1" goto :do_run_test
set /a PREV=N-1
echo [!TITLE!] Đang chờ bộ test trước đó chạy xong (các bộ test dùng chung dữ liệu mẫu nên chạy tuần tự)...
:wait_prev_test
if exist "%MK%\!PREV!.done" goto :do_run_test
timeout /t 2 /nobreak >nul
goto :wait_prev_test

:do_run_test
echo.
echo ============================================================
echo   !TITLE!  -  node !TESTFILE!
echo ============================================================
node !TESTFILE!
set "RC=!errorlevel!"
>"%MK%\!N!.done" echo done
echo.
echo ============================================================
if "!RC!"=="0" (echo   KẾT QUẢ: PASS) else (echo   KẾT QUẢ: FAIL - mã thoát !RC!)
echo   Cửa sổ này sẽ được đóng khi dừng hệ thống qua start-all.bat
echo ============================================================
title !TITLE!
endlocal
exit /b !RC!
