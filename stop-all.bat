@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/2] Dừng hệ thống Docker...
docker info >nul 2>&1
if errorlevel 1 (
  echo [LỖI] Docker Desktop chưa chạy.
  pause
  exit /b 1
)

set "ANS=N"
set /p "ANS=Xóa luôn dữ liệu database - down -v? [y/N]: "
if /i "%ANS%"=="y" (
  docker compose -f "%~dp0docker-compose.yml" -p ibanking down -v --remove-orphans
) else (
  docker compose -f "%~dp0docker-compose.yml" -p ibanking down --remove-orphans
)
echo   docker compose kết thúc, mã thoát: %errorlevel%

echo.
echo [2/2] Đóng các cửa sổ test...
call "%~dp0kill-tests.bat"

echo.
echo Hoàn tất.
pause