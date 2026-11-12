# Hệ thống đóng học phí iBanking (SOA - TDTU)

> Đồ án giữa kỳ môn Kiến trúc Hướng Dịch vụ (CS504070) - Đại học Tôn Đức Thắng.
> Kiến trúc microservices: Node.js/Express + MySQL + React (Vite), chạy bằng Docker Compose.

## 1. Giới thiệu và kiến trúc

Hệ thống gồm **4 service**, **1 MySQL server chứa 4 database riêng** (mỗi service một database và một MySQL user chỉ có quyền trên database của mình), **Mailpit** (hộp thư giả lập) và **frontend**.

| Thành phần | Cổng host | Trách nhiệm | Dữ liệu sở hữu |
|---|---|---|---|
| `frontend` (React + nginx) | 5173 | Giao diện sinh viên | - |
| `api-gateway` (nginx) | 8000 | **Điểm vào duy nhất** của frontend: định tuyến, rate limit, truy vết, chặn API nội bộ | - |
| `auth-service` | 8001 | Đăng nhập (ký JWT), số dư, trừ tiền an toàn | `auth_db.users` |
| `tuition-service` | 8002 | Tra cứu sinh viên/học phí, gạch nợ có điều kiện | `tuition_db.students`, `tuition_fees` |
| `payment-service` | 8003 | **Orchestrator**: FSM giao dịch, Saga, lịch sử | `payment_db.transactions` |
| `notification-service` | 8004 | Sinh/xác thực OTP, gửi email OTP và biên lai | `notification_db.otps` |
| `mysql` | 3307 | MySQL 8 (4 database) | - |
| `mailpit` | 8025 (web), 1025 (SMTP) | Xem mail OTP/biên lai | - |
| `swagger-ui` | 8080 | Tài liệu OpenAPI của 4 service | - |

**Nguyên tắc database-per-service:** service chỉ truy vấn bảng của chính nó; muốn dữ liệu của service khác phải gọi API (xem [docs/internal-api-contract.md](docs/internal-api-contract.md)). Không có khóa ngoại giữa các database; `transactions` lưu snapshot (`payer_name`, `payer_email`, `student_name`, `type_of_fee`) để payment không phải gọi lại service khác khi làm biên lai/lịch sử.

**Bảo mật (Đợt 2):**
- **JWT cho API công khai:** frontend gửi `Authorization: Bearer <token>` (lấy từ `POST /api/auth/login`, hạn 2 giờ). Auth ký token; tuition và payment kiểm tra bằng cùng `JWT_SECRET`. Thiếu/sai/hết hạn → `401 UNAUTHORIZED` và frontend tự đăng xuất.
- **Payment không tin `user_id` trong body:** người dùng lấy từ token. Body có `user_id` khác token → `403 FORBIDDEN`; `verify-and-pay`, `cancel`, `resend-otp` trên giao dịch của người khác → `403 FORBIDDEN`; `GET /api/payment/history` chỉ trả giao dịch của chính người dùng trong token.
- **API nội bộ cần `x-internal-secret`:** `/internal/*` của auth và tuition, cùng `/send-otp`, `/verify-otp`, `/cancel-otp`, `/send-receipt` của notification. Thiếu/sai → `401 INVALID_INTERNAL_SECRET`. Payment tự gắn header này khi gọi service khác. `/health` luôn công khai (Docker healthcheck).
- Giá trị mặc định cho đồ án: `JWT_SECRET=soa_midterm_secret`, `INTERNAL_API_SECRET=soa_internal_secret` (đổi bằng biến môi trường nếu cần).

**API Gateway, truy vết và idempotency (Đợt 4):**
- **API Gateway (nginx, cổng 8000):** frontend chỉ gọi gateway. Gateway định tuyến `/api/auth`, `/api/tuition`, `/api/payment` tới đúng service; **không công khai** `/internal/*` và notification-service (gọi vào trả `404 ROUTE_NOT_FOUND`); giới hạn đăng nhập 30 lần/phút/IP (`429`) và 20 req/giây/IP cho API chung. Cổng 8001–8004 vẫn được publish để test và Swagger; khi triển khai thật chỉ cần mở cổng 8000.
- **Truy vết (tracing) và logging:** mỗi request có `x-request-id` (gateway đặt, hoặc service tự sinh). Mã này được trả về ở header phản hồi, ghi vào **mỗi dòng log JSON** của cả 4 service (`{"ts","service","requestId","method","path","status","ms"}`) và payment truyền tiếp khi gọi auth/tuition/notification. Một thao tác của người dùng có thể lần theo bằng `docker compose logs | grep <requestId>`.
- **Idempotency:** `POST /api/payment/initiate` nhận header `Idempotency-Key`. Gửi lại cùng key và cùng nội dung → nhận lại đúng giao dịch cũ (`idempotent_replay: true`, không tạo giao dịch mới, không gửi thêm OTP); cùng key khác nội dung → `422`. Được đảm bảo bằng `UNIQUE (user_id, idempotency_key)` nên cả request song song cũng chỉ tạo một giao dịch. Frontend tự gửi key; mất mạng thì retry bằng cùng key.

**Luồng thanh toán:**
1. `initiate`: payment gọi auth (`GET /internal/users/:id`) và tuition (`GET /internal/fees/:id`) để kiểm tra, tạo giao dịch `PENDING_OTP`, nhờ notification gửi OTP.
2. `verify-and-pay`: khóa dòng giao dịch, chuyển `PENDING_OTP → PROCESSING`, xác thực OTP, gạch nợ học phí (`mark-paid`), trừ tiền (`deduct`), rồi `COMPLETED`.
3. **Saga:** nếu trừ tiền thất bại sau khi đã gạch nợ, payment gọi `revert-paid` để hoàn tác (có retry), giao dịch → `FAILED`.
4. FSM: `PENDING_OTP → PROCESSING → COMPLETED / FAILED`, hoặc `PENDING_OTP → CANCELLED`.

**Xử lý concurrency:** `SELECT ... FOR UPDATE` khi trừ tiền (auth) và khi chuyển trạng thái giao dịch (payment); `UPDATE ... WHERE status = 'Chưa thanh toán'` khi gạch nợ (tuition, chống 2 người cùng đóng 1 khoản); OTP dùng 1 lần; gửi/gửi lại OTP của một giao dịch được tuần tự hóa bằng `GET_LOCK`.

## 2. Chạy nhanh (khuyến nghị)

Yêu cầu: **Docker Desktop**.

- Windows: double-click **`start-all.bat`**, chọn chế độ email (Enter = Mailpit).
- macOS/Linux (hoặc Windows không dùng .bat): `docker compose up -d --build`. Muốn dùng Gmail thật, đặt biến môi trường `SMTP_*` / `MAIL_TO_OVERRIDE` (xem mục 4) trước khi chạy.

Mở http://localhost:5173, đăng nhập `nguyenvana` / `password123`, tra cứu MSSV `524H0024`, thanh toán, rồi xem mã OTP tại http://localhost:8025. Tài liệu API (Swagger UI): http://localhost:8080. Dừng: `stop-all.bat` hoặc `docker compose down`.

`start-all.bat` có thể mở thêm **3 cửa sổ terminal chạy test** (`test-all.js`, `test-payment.js`, `test-e2e.js`, mỗi file một cửa sổ). Ba bộ test dùng chung dữ liệu mẫu nên chạy **lần lượt** 1 → 2 → 3. `stop-all.bat` tự đóng các cửa sổ này. Ở chế độ Gmail thật, mặc định không chạy test để tránh gửi mail thật.

> Các script trong `/docker-entrypoint-initdb.d/` (thư mục `Backend/db/`) **chỉ chạy lần đầu** khi volume MySQL còn trống. Muốn nạp lại dữ liệu mẫu: `docker compose down -v` rồi chạy lại.

## 3. Chạy thủ công (không Docker)

1. Cài MySQL 8 (root/`password`, cổng 3306).
2. Nạp 4 database: `cd Backend && npm install` (để có `mysql2`), rồi `npm run init-db` (chạy lần lượt `Backend/db/00..04-*.sql`).
3. Mỗi service: `cp .env.example .env` (đã trỏ tới `auth_db`, `tuition_db`... và user riêng), `npm install && npm start`. Nếu muốn xem mail: chạy Mailpit riêng, hoặc xóa `SMTP_HOST` để dùng chế độ simulator (in mail ra terminal).
4. Frontend: `cd Frontend && npm install && npm run dev` (http://localhost:5173).

## 4. Cấu hình email

- **Mailpit (mặc định):** `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, không cần đăng nhập. Xem mail tại http://localhost:8025.
- **Simulator:** không đặt `SMTP_HOST` thì nội dung mail được in ra terminal của notification-service.
- **Gmail thật:**
  1. Bật xác thực 2 bước cho Gmail dùng để **gửi**.
  2. Tạo App Password tại https://myaccount.google.com/apppasswords (16 ký tự, không khoảng trắng).
  3. Đặt `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<gmail gửi>`, `SMTP_PASS=<App Password của gmail gửi>`, `MAIL_TO_OVERRIDE=<email nhận OTP>`.
  - `SMTP_PASS` là App Password của **Gmail gửi**; `MAIL_TO_OVERRIDE` là **email nhận OTP** (mọi mail OTP/biên lai sẽ gửi tới địa chỉ này, nội dung ghi kèm "Người nhận gốc").
  - `start-all.bat` chọn chế độ 2 sẽ hỏi lần lượt các giá trị này (App Password được ẩn khi nhập và không ghi ra file).
- Kiểm tra nhanh: `cd Backend/notification-service && npm run test:mail -- <email>`.
- `GET http://localhost:8004/health` cho biết `mailMode` (`smtp`/`simulator`) và `mailOverride`.

## 5. API công khai (URI chuẩn hóa)

| Method | URI | Xác thực | Mô tả |
|---|---|---|---|
| POST | `/api/auth/login` (8001) | - | Đăng nhập, nhận JWT |
| GET | `/api/auth/profile` (8001) | Bearer JWT | Thông tin tài khoản + số dư |
| GET | `/api/tuition/students/:student_id` (8002) | Bearer JWT | Tra cứu sinh viên + học phí |
| POST | `/api/payment/initiate` (8003) | Bearer JWT | Khởi tạo giao dịch + gửi OTP (body `{fee_id, student_id, amount}`, **không** gửi `user_id`) |
| POST | `/api/payment/verify-and-pay` (8003) | Bearer JWT | Xác thực OTP + thanh toán |
| POST | `/api/payment/cancel` (8003) | Bearer JWT | Hủy giao dịch đang chờ OTP |
| POST | `/api/payment/resend-otp` (8003) | Bearer JWT | Gửi lại OTP |
| GET | `/api/payment/history` (8003) | Bearer JWT | Lịch sử giao dịch của chính mình |

Đã gỡ các URI cũ: `POST /login`, `GET /profile`, `GET /lookup/:id`, `POST /initiate`, `GET /api/payment/history/:user_id` (gọi vào sẽ nhận 404). API nội bộ (`/internal/*`, notification) giữ nguyên URI, xem [docs/internal-api-contract.md](docs/internal-api-contract.md). Đặc tả OpenAPI đầy đủ (schema, ví dụ, mã lỗi): `docs/api/auth.yaml`, `tuition.yaml`, `payment.yaml`, `notification.yaml`. Trong Swagger UI bấm **Authorize**: nhập JWT cho `bearerAuth`, hoặc `soa_internal_secret` cho `internalSecret`.

## 6. Dữ liệu demo

- Tài khoản (mật khẩu `password123`): `nguyenvana`, `tranthib`, `lehoangc`, `phamminhd`, `vothue`, `ngothif`, `admin`.
- MSSV mẫu: `524H0024`, `524H0129`, `524H0041`.

## 7. URL, cổng, MySQL

| | |
|---|---|
| Frontend | http://localhost:5173 |
| API Gateway | http://localhost:8000 (frontend gọi qua đây) |
| API trực tiếp | 8001 (auth), 8002 (tuition), 8003 (payment), 8004 (notification, nội bộ) - dùng cho test/debug |
| Swagger UI (OpenAPI) | http://localhost:8080 (đặc tả ở `docs/api/*.yaml`) |
| Mailpit | http://localhost:8025 |
| MySQL (Docker) | host `localhost`, cổng **3307**, user `root`, mật khẩu `password` |
| User theo service | `auth_user/auth_pass` → `auth_db`; `tuition_user/tuition_pass` → `tuition_db`; `payment_user/payment_pass` → `payment_db`; `notification_user/notification_pass` → `notification_db` |

Reset dữ liệu: `docker compose down -v`.

## 8. Chạy test

Cần stack Docker đang chạy (MySQL ở cổng 3307):

```
cd Backend
npm install                  # cài mysql2 cho test (một lần)
npm test                     # chạy cả 2 bộ test; dừng và trả mã lỗi khác 0 nếu có test fail
npm run test:auth-tuition    # chỉ auth + tuition + bảo mật (JWT, x-internal-secret)
npm run test:payment         # notification + payment, Mailpit, schema, 2 tình huống concurrency, Saga
npm run test:e2e             # E2E qua API Gateway: đăng nhập → tra cứu → thanh toán → OTP email → lịch sử, idempotency, truy vết
```

Test tự kiểm tra stack đã chạy chưa (4 service + MySQL) và báo rõ nếu thiếu. Nhóm test Mailpit chỉ chạy khi hệ thống gửi mail qua Mailpit; đang dùng Gmail thật hoặc `MAIL_TO_OVERRIDE` thì ghi `[SKIP]` (không tính là lỗi). Hai tình huống của đề: **CONCURRENCY A** (một tài khoản trả đồng thời nhiều khoản, số dư chỉ đủ một khoản) và **CONCURRENCY B** (nhiều tài khoản cùng trả một khoản học phí).

Test payment dùng một pool root và ghi rõ tên database trước tên bảng; biến `DB_HOST`, `DB_PORT` (mặc định 3307), `DB_USER`, `DB_PASSWORD` có thể ghi đè. Đặt `KEEP_TEST_DATA=1` để giữ lại giao dịch test; `MAILPIT_URL` đổi địa chỉ Mailpit. Test tự đăng nhập để lấy JWT và gửi `x-internal-secret` (mặc định `soa_internal_secret`, ghi đè bằng biến `INTERNAL_API_SECRET`).

**Sự cố thường gặp**
- *Cổng 3307/5173/800x bị chiếm:* tắt chương trình đang dùng cổng đó hoặc đổi ánh xạ cổng trong `docker-compose.yml`.
- *Không thấy dữ liệu mẫu / sai dữ liệu:* script nạp DB chỉ chạy lần đầu → `docker compose down -v` rồi chạy lại.
- *API trả 401 `INVALID_INTERNAL_SECRET` khi gọi trực tiếp /internal:* thêm header `x-internal-secret: soa_internal_secret`. *Trả 401 `UNAUTHORIZED`:* đăng nhập lại để lấy token mới (token hết hạn sau 2 giờ).
- *Đổi `JWT_SECRET` / `INTERNAL_API_SECRET` nhưng vẫn 401:* phải đặt cùng một giá trị cho tất cả service liên quan rồi `docker compose up -d --force-recreate`.
- *Frontend báo không kết nối được dịch vụ:* chạy `docker compose ps` và `docker compose logs <service>`.
- *Không nhận được mail Gmail:* kiểm tra App Password (của Gmail gửi), `MAIL_TO_OVERRIDE`, và `npm run test:mail`.

## 9. Ràng buộc dữ liệu

Có `CHECK`: `users.balance >= 0`, `tuition_fees.price > 0`, `transactions.amount > 0`; index trên `transactions(user_id, created_at)`, `(fee_id)`, `(status)`. Trừ tiền thực hiện bằng `UPDATE users SET balance = balance - ?` trong SQL (không tính bằng số thực JS). Cần MySQL 8.0.16 trở lên (image `mysql:8` trong compose đáp ứng).

## 10. Quản lý repo

`.gitignore` đã loại `.env` và `node_modules`; chỉ commit các file `.env.example`. Nếu `.env` từng được commit, chạy một lần: `git rm --cached Backend/*/.env` rồi commit.

## 11. Tài liệu thiết kế

Toàn bộ sơ đồ nằm trong [docs/diagrams.md](docs/diagrams.md) (Mermaid: xem trên GitHub/VS Code hoặc dán vào https://mermaid.live để xuất PNG đưa vào báo cáo):

1. Use Case Diagram
2. ERD của 4 database (kèm bảng ownership)
3. **Microservices Architecture Diagram** (gateway, 4 service, database, SMTP, luồng gọi) và lý do chọn kiến trúc
4. Sequence diagram luồng thanh toán (gồm nhánh Saga)
5. Máy trạng thái giao dịch (FSM)
6. Hai tình huống concurrency và cơ chế xử lý

Đặc tả API: Swagger UI http://localhost:8080 (`docs/api/*.yaml`) và [docs/internal-api-contract.md](docs/internal-api-contract.md).

**Giải thích lựa chọn kiến trúc:** chọn *1 MySQL server, 4 database riêng* (thay vì 4 server) để vừa đảm bảo ranh giới dữ liệu của từng service (mỗi service có user riêng, không truy vấn chéo bảng) vừa nhẹ để chạy demo trên một máy. Vì không có khóa ngoại chéo database, tính toàn vẹn giữa các service được đảm bảo ở tầng ứng dụng: payment kiểm tra qua API, dùng FSM + Saga bù hoàn, còn các thao tác nhạy cảm (trừ tiền, gạch nợ) dùng khóa dòng / cập nhật có điều kiện ngay trong service sở hữu dữ liệu.
