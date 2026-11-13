<# :
@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create([System.IO.File]::ReadAllText('%~f0', [System.Text.Encoding]::UTF8))) @args" %*
exit /b %errorlevel%
#>
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ROOT = (Get-Location).Path

function Stop-System {
    Write-Host ""
    Write-Host "[1/1] Dừng hệ thống Docker..." -ForegroundColor Yellow
    $ans = Read-Host "Xóa luôn dữ liệu database (down -v)? [y/N]"
    if ($ans -match '^[yY]$') {
        docker compose -f "$ROOT\docker-compose.yml" -p ibanking down -v --remove-orphans
    } else {
        docker compose -f "$ROOT\docker-compose.yml" -p ibanking down --remove-orphans
    }
    Write-Host ""
    Write-Host "Hoàn tất." -ForegroundColor Green
    Read-Host "Nhấn Enter để đóng"
    exit 0
}

if ($args.Count -gt 0 -and $args[0] -eq 'stop') {
    Stop-System
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  TDTU iBanking - Quản lý hệ thống (Docker Compose)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Kiểm tra Docker
docker --version *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[LỖI] Chưa cài Docker Desktop." -ForegroundColor Red
    Write-Host "  Tải và cài đặt tại: https://www.docker.com/products/docker-desktop/"
    Read-Host "Nhấn Enter để thoát"
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[LỖI] Docker Desktop chưa chạy." -ForegroundColor Red
    Write-Host "  Hãy mở Docker Desktop, đợi biểu tượng cá voi báo 'running' rồi chạy lại file này."
    Read-Host "Nhấn Enter để thoát"
    exit 1
}

# 2. Chọn chế độ
Write-Host "Chọn thao tác / chế độ gửi email OTP:"
Write-Host "  [1] Khởi động với Mailpit (mặc định - xem mail trên web)"
Write-Host "  [2] Khởi động với Gmail thật"
Write-Host "  [3] Dừng toàn bộ hệ thống Docker"
$mode = Read-Host "Nhập 1, 2 hoặc 3 (Enter = 1)"
if ([string]::IsNullOrWhiteSpace($mode)) { $mode = "1" }

if ($mode -eq "3") {
    Stop-System
}

$env:SMTP_USER = ""
$env:SMTP_PASS = ""
$env:SMTP_FROM = ""
$env:MAIL_TO_OVERRIDE = ""

if ($mode -eq "2") {
    Write-Host ""
    Write-Host "---- Hướng dẫn tạo App Password cho Gmail GỬI ----" -ForegroundColor Yellow
    Write-Host "  1. Bật xác thực 2 bước cho tài khoản Gmail dùng để gửi."
    Write-Host "  2. Mở https://myaccount.google.com/apppasswords"
    Write-Host "  3. Tạo mật khẩu ứng dụng (16 ký tự) và dán vào bên dưới."
    Write-Host ""
    do {
        $smtpUser = Read-Host "Gmail GỬI (SMTP_USER)"
    } while ($smtpUser -notmatch "@")

    do {
        $sec = Read-Host "App Password của Gmail gửi (ẩn ký tự)" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        $smtpPass = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)) -replace '\s+', ''
    } while ([string]::IsNullOrWhiteSpace($smtpPass))

    do {
        $mailTo = Read-Host "Email NHẬN OTP (MAIL_TO_OVERRIDE)"
    } while ($mailTo -notmatch "@")

    $env:SMTP_HOST = "smtp.gmail.com"
    $env:SMTP_PORT = "587"
    $env:SMTP_USER = $smtpUser.Trim()
    $env:SMTP_PASS = $smtpPass
    $env:MAIL_TO_OVERRIDE = $mailTo.Trim()
    $mailInfo = "Mail gửi tới: $($env:MAIL_TO_OVERRIDE)"
} else {
    $env:SMTP_HOST = "mailpit"
    $env:SMTP_PORT = "1025"
    $mailInfo = "Mailpit     : http://localhost:8025"
}

# 3. Tự động kiểm tra xung đột cổng 8080 (Swagger UI)
if (-not $env:SWAGGER_PORT) {
    $busy8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $p = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        $p -and ($p -notmatch 'docker|vpnkit')
    }
    if ($busy8080) {
        $env:SWAGGER_PORT = "8088"
        Write-Host "[LƯU Ý] Cổng 8080 đang bị phần mềm khác trên máy chiếm -> tự động chuyển Swagger UI sang cổng 8088." -ForegroundColor Yellow
    } else {
        $env:SWAGGER_PORT = "8080"
    }
}

# 4. Chạy docker compose
Write-Host ""
Write-Host "Đang build và khởi động các container (lần đầu có thể mất vài phút)..." -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[LỖI] docker compose thất bại. Xem thông báo phía trên." -ForegroundColor Red
    Read-Host "Nhấn Enter để thoát"
    exit 1
}

# 4. Chờ các container healthy
Write-Host ""
Write-Host "Đang chờ các dịch vụ sẵn sàng (tối đa ~3 phút)..." -ForegroundColor Cyan
$containers = @("ibanking_mysql", "ibanking_auth", "ibanking_tuition", "ibanking_notification", "ibanking_payment", "ibanking_gateway")
for ($tries = 1; $tries -le 60; $tries++) {
    $notReady = @()
    foreach ($c in $containers) {
        $st = (docker inspect -f "{{.State.Health.Status}}" $c 2>$null)
        if ($st -ne "healthy") { $notReady += $c }
    }
    if ($notReady.Count -eq 0) { break }
    if ($tries -eq 60) {
        Write-Host "[CẢNH BÁO] Hết thời gian chờ. Chưa sẵn sàng: $($notReady -join ', ')" -ForegroundColor Yellow
        Read-Host "Nhấn Enter để thoát"
        exit 1
    }
    Write-Host "  [$tries/60] Chưa sẵn sàng: $($notReady -join ' ')"
    Start-Sleep -Seconds 3
}

# 5. Bảng thông tin
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  HỆ THỐNG ĐÃ SẴN SÀNG" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Frontend    : http://localhost:5173"
Write-Host "  API Gateway : http://localhost:8000  (frontend gọi API qua đây)"
Write-Host "  Auth API    : http://localhost:8001"
Write-Host "  Tuition     : http://localhost:8002"
Write-Host "  Payment     : http://localhost:8003"
Write-Host "  Notification: http://localhost:8004  (API nội bộ, cần x-internal-secret)"
Write-Host "  Swagger UI  : http://localhost:$($env:SWAGGER_PORT)  (tài liệu OpenAPI 4 service)"
Write-Host "  $mailInfo"
Write-Host ""
Write-Host "  MySQL       : host localhost, cổng 3307, user root, mật khẩu password"
Write-Host "                (user riêng: auth_user, tuition_user, payment_user, notification_user)"
Write-Host ""
Write-Host "  Tài khoản demo : nguyenvana / password123, tranthib / password123"
Write-Host "  MSSV mẫu       : 524H0024, 524H0129"
Write-Host ""
Write-Host "  Dừng hệ thống  : chạy lại start-all.bat chọn [3] (hoặc: .\start-all.bat stop)"
Write-Host "  Reset dữ liệu  : docker compose down -v"
Write-Host "============================================================" -ForegroundColor Green

Start-Process "http://localhost:5173"
if ($mode -eq "1") {
    Start-Process "http://localhost:8025"
}

# 6. Chạy test tự động ngay trong cửa sổ hiện tại (không mở cửa sổ mới)
Write-Host ""
$defaultTest = if ($mode -eq "1") { "Y" } else { "N" }
$runTest = Read-Host "Chạy 3 bộ test tự động ngay trong cửa sổ này? [Y/N] (Enter = $defaultTest)"
if ([string]::IsNullOrWhiteSpace($runTest)) { $runTest = $defaultTest }

if ($runTest -match '^[yY]$') {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[CẢNH BÁO] Chưa cài Node.js nên không chạy được test." -ForegroundColor Yellow
    } else {
        Push-Location "$ROOT\Backend"
        if (-not (Test-Path "node_modules\mysql2")) {
            Write-Host "Đang cài thư viện cho test - npm install..." -ForegroundColor Cyan
            npm install
        }
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  [1/3] TEST AUTH + TUITION (node test-all.js)" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        node test-all.js

        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  [2/3] TEST PAYMENT + NOTIFICATION + CONCURRENCY (node test-payment.js)" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        node test-payment.js

        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  [3/3] TEST END-TO-END QUA GATEWAY (node test-e2e.js)" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        node test-e2e.js
        Pop-Location
    }
}

Write-Host ""
Read-Host "Nhấn Enter để đóng cửa sổ này"
