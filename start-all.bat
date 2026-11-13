@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   TDTU iBanking - Khởi động toàn bộ hệ thống (Docker)
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

rem ---------- 2. Chọn chế độ email ----------
echo Chọn chế độ gửi email OTP / biên lai:
echo   [1] Mailpit (mặc định) - không cần cấu hình, xem mail trên web
echo   [2] Gmail thật
set "MODE=1"
set /p "MODE=Nhập 1 hoặc 2 (Enter = 1): "
if "!MODE!"=="" set "MODE=1"

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

rem ---------- 5-6. Chạy compose (cấu hình chỉ nằm trong biến môi trường của phiên cmd này) ----------
:run
echo.
echo Đang build và khởi động các container (lần đầu có thể mất vài phút)...
rem Chạy lại file .bat với chế độ khác: compose tự tạo lại container khi biến môi trường thay đổi.
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
echo   HỆ THỐNG ĐÃ SẴN SÀNG
echo ============================================================
echo   Frontend  : http://localhost:5173
echo   API Gateway: http://localhost:8000  (frontend gọi API qua đây)
echo   Auth API  : http://localhost:8001
echo   Tuition   : http://localhost:8002
echo   Payment   : http://localhost:8003
echo   Notification: http://localhost:8004  (API nội bộ, cần x-internal-secret)
echo   Swagger UI : http://localhost:8080  (tài liệu OpenAPI 4 service)
echo   !MAILINFO!
echo.
echo   MySQL     : host localhost, cổng 3307, user root, mật khẩu password
echo               (user riêng: auth_user, tuition_user, payment_user, notification_user)
echo.
echo   Tài khoản demo : nguyenvana / password123, tranthib / password123
echo   MSSV mẫu       : 524H0024, 524H0129
echo.
echo   Dừng hệ thống     : stop-all.bat  (đồng thời đóng các cửa sổ test)
echo   Reset dữ liệu     : docker compose down -v
echo ============================================================
start "" "http://localhost:5173"
rem Mailpit chỉ có khi dùng chế độ 1 (Mailpit); chế độ Gmail thì mail đi vào hộp thư thật
if "!MODE!"=="1" start "" "http://localhost:8025"

rem ---------- 8. Mở các cửa sổ chạy test tự động (mỗi file test 1 cửa sổ, chạy tuần tự) ----------
echo.
rem Chế độ Gmail: test sẽ gửi mail thật tới MAIL_TO_OVERRIDE nên mặc định KHÔNG chạy
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

rem Đóng cửa sổ test của lần chạy trước (nếu còn) rồi tạo thư mục đánh dấu mới
call "%~dp0kill-tests.bat"
md "%TEMP%\ibanking_tests" >nul 2>&1

start "TEST-1-AUTH-TUITION" cmd /k call "%~dp0run-test.bat" 1 TEST-1-AUTH-TUITION test-all.js
start "TEST-2-PAYMENT" cmd /k call "%~dp0run-test.bat" 2 TEST-2-PAYMENT test-payment.js
start "TEST-3-E2E" cmd /k call "%~dp0run-test.bat" 3 TEST-3-E2E test-e2e.js
echo Đã mở 3 cửa sổ test. Chúng chạy lần lượt 1 → 2 → 3 và sẽ được đóng khi chạy stop-all.bat.
:skiptests
pause
endlocal
