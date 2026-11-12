# Hợp đồng API nội bộ giữa các service

Mọi response đều là JSON: `{ "success": true|false, "message": "...", "code": "...", "data": {...} }`.
Các API này **chỉ dành cho service gọi service** (trừ khi ghi chú khác). Payment-service là orchestrator.
**Từ Đợt 2**, mọi API nội bộ dưới đây bắt buộc header `x-internal-secret: <INTERNAL_API_SECRET>`; thiếu/sai → **401** `{ "success": false, "code": "INVALID_INTERNAL_SECRET" }`. Riêng `GET /health` luôn công khai. Payment-service tự gắn header này trong `callService`. Đặc tả OpenAPI đầy đủ nằm ở `docs/api/*.yaml` (xem Swagger UI tại http://localhost:8080).

| Service | Cổng | Database | Sở hữu bảng |
|---|---|---|---|
| auth-service | 8001 | `auth_db` | `users` |
| tuition-service | 8002 | `tuition_db` | `students`, `tuition_fees` |
| payment-service | 8003 | `payment_db` | `transactions` |
| notification-service | 8004 | `notification_db` | `otps` |

---

## auth-service (8001)

API công khai (cho frontend): `POST /api/auth/login`, `GET /api/auth/profile` (Bearer JWT). Xem `docs/api/auth.yaml`. Các endpoint `/internal/*` bên dưới yêu cầu `x-internal-secret`.

### `GET /internal/users/:user_id`  — MỚI (Đợt 1)
- **200**: `{ "success": true, "data": { "user_id", "full_name", "email", "balance" } }` (`balance` là number)
- **404**: `{ "success": false, "code": "USER_NOT_FOUND", "message": "Người dùng không tồn tại" }`

### `POST /internal/deduct`
- Request: `{ "user_id", "amount", "transaction_id" }`
- **200**: `{ "success": true, "message": "Trừ tiền thành công", "data": { "new_balance": number } }`
- **400**: thiếu tham số (`Thông tin trừ tiền không hợp lệ`) hoặc `Số dư không đủ` (payment dựa vào status 400 để phân biệt hết tiền)
- **404**: `Người dùng không tồn tại`
- Cơ chế: `SELECT ... FOR UPDATE` trong transaction (chống double spending).

### `GET /health` → `{ "success": true, "service": "auth-service" }`

---

## tuition-service (8002)

API công khai: `GET /api/tuition/students/:student_id` (Bearer JWT, cùng `JWT_SECRET` với auth). Xem `docs/api/tuition.yaml`. Các endpoint `/internal/*` bên dưới yêu cầu `x-internal-secret`.

### `GET /internal/fees/:fee_id`  — MỚI (Đợt 1)
- **200**: `{ "success": true, "data": { "fee_id", "student_id", "student_name", "price", "type_of_fee", "status" } }`
  (`status` là chuỗi tiếng Việt như trong DB: `Chưa thanh toán` / `Đã thanh toán`; `student_name` lấy bằng JOIN `students` trong `tuition_db`)
- **404**: `{ "success": false, "code": "FEE_NOT_FOUND", "message": "Không tìm thấy học phí" }`

### `POST /internal/mark-paid`
- Request: `{ "fee_id", "transaction_id" }`
- **200**: `{ "success": true, "data": { "fee_id", "status": "Đã thanh toán" } }`
- **400**: thiếu `fee_id`/`transaction_id`
- **404**: không tìm thấy học phí
- **409** `ALREADY_PAID`: đã thanh toán trước đó; **409** `CONCURRENCY_CONFLICT`: vừa bị người khác thanh toán
- Cơ chế: `FOR UPDATE` + `UPDATE ... WHERE status = 'Chưa thanh toán'` (chống double payment).

### `POST /internal/revert-paid` (Saga bù hoàn)
- Request: `{ "fee_id", "transaction_id" }`
- **200**: `{ "success": true, "message": "Đã hoàn tác trạng thái học phí" }`; **500** nếu lỗi.

### `GET /health` → `{ "success": true, "service": "tuition-service" }`

---

## notification-service (8004)

### `POST /send-otp`
- Request: `{ "transaction_id", "email", "amount" }`
- **200**: `{ "success": true, "data": { "transaction_id", "expires_in": 300 } }`
- **400** `INVALID_REQUEST`; **502** `EMAIL_SEND_FAILED`; **503** `OTP_BUSY` (không lấy được khóa `GET_LOCK` trong 5 giây)
- Không còn kiểm tra bảng `transactions` (thuộc `payment_db`): payment-service tự kiểm tra trạng thái giao dịch trước khi gọi.
- Gửi/gửi lại OTP của cùng 1 giao dịch được tuần tự hóa bằng `GET_LOCK('otp:<transaction_id>', 5)`.

### `POST /verify-otp`
- Request: `{ "transaction_id", "otp_code" }` (6 chữ số)
- **200**: `{ "success": true, "data": { "transaction_id" } }`; đồng thời mọi OTP `PENDING` còn lại của giao dịch chuyển sang `EXPIRED`.
- **400**: `OTP_EXPIRED` / `OTP_MISMATCH` / `OTP_ALREADY_USED` / `INVALID_REQUEST`
- **404**: `OTP_NOT_FOUND`

### `POST /cancel-otp`
- Request: `{ "transaction_id" }` → **200** `{ "data": { "transaction_id", "cancelled": n } }`; **400** `INVALID_REQUEST`.

### `POST /send-receipt`
- Request: `{ "email", "transaction_id", "full_name", "student_id", "student_name", "amount" }`
- **200**: `{ "success": true, "data": { "transaction_id", "mode": "smtp"|"simulator" } }`; **400** `INVALID_REQUEST`; **502** `EMAIL_SEND_FAILED`.

### `GET /health`
`{ "success": true, "service": "notification-service", "smtp": bool, "mailMode": "smtp"|"simulator", "mailOverride": bool }`

---

## payment-service (8003) — API công khai cho frontend

Mọi `/api/payment/*` yêu cầu `Authorization: Bearer <JWT>` (token từ `POST /api/auth/login`). Thiếu/sai/hết hạn → **401** `UNAUTHORIZED`. `user_id` luôn lấy từ token; body có `user_id` khác token → **403** `FORBIDDEN`; thao tác trên giao dịch của người khác → **403** `FORBIDDEN`.

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/api/payment/initiate` | Body `{ fee_id, student_id, amount }` (không gửi `user_id`). Mã lỗi: `INVALID_REQUEST`, `INVALID_AMOUNT`, `FORBIDDEN`, `USER_NOT_FOUND`, `INSUFFICIENT_BALANCE`, `FEE_NOT_FOUND`, `FEE_STUDENT_MISMATCH`, `ALREADY_PAID`, `AMOUNT_MISMATCH`, `SERVICE_UNAVAILABLE` (503: auth/tuition không gọi được), `OTP_SEND_FAILED` (502) |
| POST | `/api/payment/verify-and-pay` | Body `{ transaction_id, otp_code }` |
| POST | `/api/payment/cancel` | Body `{ transaction_id }` |
| POST | `/api/payment/resend-otp` | Body `{ transaction_id }` |
| GET | `/api/payment/history` | Lịch sử của chính người dùng trong token. Chỉ truy vấn `payment_db.transactions`; user không có giao dịch → `data: []` |
| GET | `/health` | |

Payment đọc `deduct.data.data.new_balance` (auth) và `otp.data.data.expires_in` (notification): **không đổi shape** các response này.

### Bảng `transactions` (payment_db) có thêm cột snapshot
`payer_name`, `payer_email`, `student_name`, `type_of_fee` — ghi lúc `initiate` để làm biên lai / lịch sử / gửi lại OTP mà không phải gọi service khác. Không có khóa ngoại sang `users` / `tuition_fees`.


## Truy vết (x-request-id)

Mọi service nhận/sinh `x-request-id` và trả lại ở header phản hồi; payment truyền tiếp header này (cùng `x-internal-secret`) cho auth, tuition và notification, nên một thao tác của người dùng có cùng `requestId` trong log của mọi service.
