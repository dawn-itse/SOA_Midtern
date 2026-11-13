# Hợp đồng API nội bộ giữa các service

Mọi response đều là JSON: `{ "success": true|false, "message": "...", "code": "...", "data": {...} }` (`code` có ở hầu hết lỗi, `data` có ở các phản hồi thành công).

Các API này **chỉ dành cho service gọi service** (trừ khi ghi chú khác). Payment-service là orchestrator và là bên gọi duy nhất. Mọi API nội bộ bắt buộc header `x-internal-secret: <INTERNAL_API_SECRET>`; thiếu/sai → **401** `{ "success": false, "code": "INVALID_INTERNAL_SECRET" }`. Riêng `GET /health` luôn công khai. Payment-service tự gắn header này (và `x-request-id`) trong `callService`. API Gateway **không công khai** `/internal/*` và notification-service (trả `404 ROUTE_NOT_FOUND`). Đặc tả OpenAPI đầy đủ nằm ở `docs/api/*.yaml` (Swagger UI tại http://localhost:8080).

| Service | Cổng | Database | Sở hữu bảng |
|---|---|---|---|
| auth-service | 8001 | `auth_db` | `users` |
| tuition-service | 8002 | `tuition_db` | `students`, `tuition_fees` |
| payment-service | 8003 | `payment_db` | `transactions` |
| notification-service | 8004 | `notification_db` | `otps` |

Đồ thị gọi: **payment → auth**, **payment → tuition**, **payment → notification**. Không có service nào khác gọi service khác.

---

## auth-service (8001)

API công khai (cho frontend): `POST /api/auth/login`, `GET /api/auth/profile` (Bearer JWT). Xem `docs/api/auth.yaml`. Các endpoint `/internal/*` bên dưới yêu cầu `x-internal-secret`.

### `GET /internal/users/:user_id`
Payment dùng ở bước `initiate` để lấy họ tên, email và số dư của người nộp.
- **200**: `{ "success": true, "data": { "user_id", "full_name", "email", "balance" } }` (`balance` là number)
- **404**: `{ "success": false, "code": "USER_NOT_FOUND", "message": "Người dùng không tồn tại" }`

### `POST /internal/deduct`
- Request: `{ "user_id", "amount", "transaction_id" }`
- **200**: `{ "success": true, "message": "Trừ tiền thành công", "data": { "new_balance": number } }`
- **400**: thiếu/sai tham số (`Thông tin trừ tiền không hợp lệ`) hoặc `Số dư không đủ` (payment dựa vào status 400 để phân biệt hết tiền với lỗi khác)
- **404**: `Người dùng không tồn tại`
- **500**: lỗi server
- Cơ chế: trong một transaction DB, `SELECT balance, balance >= ? ... FOR UPDATE` khóa dòng, so sánh ngay trong SQL (DECIMAL), rồi `UPDATE users SET balance = balance - ?`. Chống double spending khi nhiều giao dịch cùng đánh vào một tài khoản. Bảng còn có `CHECK (balance >= 0)` làm lớp bảo vệ cuối.

### `GET /health`
`{ "success": true, "service": "auth-service" }`

---

## tuition-service (8002)

API công khai: `GET /api/tuition/students/:student_id` (Bearer JWT, kiểm tra bằng cùng `JWT_SECRET` với auth). Xem `docs/api/tuition.yaml`. Các endpoint `/internal/*` bên dưới yêu cầu `x-internal-secret`.

### `GET /internal/fees/:fee_id`
Payment dùng ở bước `initiate` để kiểm tra khoản học phí.
- **200**: `{ "success": true, "data": { "fee_id", "student_id", "student_name", "price", "type_of_fee", "status" } }`
  (`status` là chuỗi tiếng Việt như trong DB: `Chưa thanh toán` / `Đã thanh toán`; `student_name` lấy bằng JOIN `students` trong `tuition_db`)
- **404**: `{ "success": false, "code": "FEE_NOT_FOUND", "message": "Không tìm thấy học phí" }`

### `POST /internal/mark-paid`
- Request: `{ "fee_id", "transaction_id" }`
- **200**: `{ "success": true, "data": { "fee_id", "status": "Đã thanh toán" } }`
- **400**: thiếu `fee_id`/`transaction_id`
- **404**: không tìm thấy học phí
- **409** `ALREADY_PAID`: đã thanh toán trước đó; **409** `CONCURRENCY_CONFLICT`: vừa bị người khác thanh toán
- **500**: lỗi server
- Cơ chế: `SELECT ... FOR UPDATE` + `UPDATE ... WHERE status = 'Chưa thanh toán'` và kiểm tra `affectedRows` (chống double payment).

### `POST /internal/revert-paid` (Saga bù hoàn)
Payment chỉ gọi sau khi chính nó đã `mark-paid` thành công mà bước trừ tiền sau đó thất bại.
- Request: `{ "fee_id", "transaction_id" }`
- **200**: `{ "success": true, "message": "Đã hoàn tác trạng thái học phí" }`
- **500**: lỗi server (payment retry tối đa 3 lần, sau đó đánh dấu giao dịch `FAILED` với mã `COMPENSATION_FAILED` để đối soát thủ công)
- Lưu ý: body không được kiểm tra và câu `UPDATE` không có điều kiện; chỉ an toàn vì endpoint chỉ được gọi cho khoản phí mà chính giao dịch đó vừa gạch nợ.

### `GET /health`
`{ "success": true, "service": "tuition-service" }`

---

## notification-service (8004)

Mọi endpoint trừ `/health` yêu cầu `x-internal-secret`. Quy tắc OTP: 6 chữ số (CSPRNG), hiệu lực 300 giây, dùng một lần, gắn với một `transaction_id`, lưu trong `notification_db.otps` với trạng thái `PENDING` / `VERIFIED` / `EXPIRED`.

### `POST /send-otp`
- Request: `{ "transaction_id", "email", "amount" }`
- **200**: `{ "success": true, "message": "OTP sent successfully", "data": { "transaction_id", "expires_in": 300 } }`
- **400** `INVALID_REQUEST`; **502** `EMAIL_SEND_FAILED` (OTP vừa tạo bị vô hiệu hóa); **503** `OTP_BUSY` (không lấy được khóa `GET_LOCK` trong 5 giây); **500** `INTERNAL_ERROR`
- Không kiểm tra bảng `transactions` (thuộc `payment_db`): payment tự kiểm tra trạng thái giao dịch trước khi gọi.
- Gửi/gửi lại OTP của cùng một giao dịch được tuần tự hóa bằng `GET_LOCK('otp:<transaction_id>', 5)`. Mọi OTP `PENDING` cũ của giao dịch đó chuyển sang `EXPIRED`.

### `POST /verify-otp`
- Request: `{ "transaction_id", "otp_code" }` (`otp_code` phải là 6 chữ số)
- **200**: `{ "success": true, "data": { "transaction_id" } }`; đồng thời mọi OTP `PENDING` còn lại của giao dịch chuyển sang `EXPIRED`.
- **400**: `OTP_EXPIRED` / `OTP_MISMATCH` / `OTP_ALREADY_USED` / `INVALID_REQUEST`
- **404**: `OTP_NOT_FOUND`
- Cơ chế: `SELECT ... FOR UPDATE` trên OTP `PENDING` mới nhất + `UPDATE ... WHERE status = 'PENDING'`, nên hai request verify cùng lúc không thể cùng thành công.

### `POST /cancel-otp`
- Request: `{ "transaction_id" }`
- **200**: `{ "success": true, "data": { "transaction_id", "cancelled": n } }`; **400** `INVALID_REQUEST`; **500** `INTERNAL_ERROR`

### `POST /send-receipt`
- Request: `{ "email", "transaction_id", "full_name", "student_id", "student_name", "amount" }`
- **200**: `{ "success": true, "message": "Receipt sent successfully", "data": { "transaction_id", "mode": "smtp"|"simulator" } }`
- **400** `INVALID_REQUEST`; **502** `EMAIL_SEND_FAILED`
- Lỗi ở đây không bao giờ ảnh hưởng kết quả thanh toán (payment gọi bất đồng bộ và chỉ ghi log lỗi).

### `GET /health`
`{ "success": true, "service": "notification-service", "smtp": bool, "mailMode": "smtp"|"simulator", "mailOverride": bool }`

---

## payment-service (8003) - API công khai cho frontend

Mọi `/api/payment/*` yêu cầu `Authorization: Bearer <JWT>` (token từ `POST /api/auth/login`). Thiếu/sai/hết hạn → **401** `UNAUTHORIZED`. `user_id` luôn lấy từ token; body có `user_id` khác token → **403** `FORBIDDEN`; thao tác trên giao dịch của người khác cũng → **403** `FORBIDDEN`.

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/api/payment/initiate` | Body `{ fee_id, student_id, amount }` (không gửi `user_id`). Header tùy chọn `Idempotency-Key` (8-64 ký tự gồm chữ, số, `.`, `_`, `-`). |
| POST | `/api/payment/verify-and-pay` | Body `{ transaction_id, otp_code }` |
| POST | `/api/payment/cancel` | Body `{ transaction_id }` |
| POST | `/api/payment/resend-otp` | Body `{ transaction_id }` |
| GET | `/api/payment/history` | Giao dịch của chính người dùng trong token, mới nhất trước. Chỉ truy vấn `payment_db.transactions`; chưa có giao dịch → `data: []` |
| GET | `/health` | Công khai |

### Mã lỗi theo endpoint

| Endpoint | Status → code |
|---|---|
| `initiate` | 400 `INVALID_REQUEST`, `INVALID_AMOUNT`, `INVALID_IDEMPOTENCY_KEY`, `INSUFFICIENT_BALANCE`, `FEE_STUDENT_MISMATCH`, `AMOUNT_MISMATCH` · 401 `UNAUTHORIZED` · 403 `FORBIDDEN` · 404 `USER_NOT_FOUND`, `FEE_NOT_FOUND` · 409 `ALREADY_PAID`, `FEE_LOCKED` (người khác đang có giao dịch hoạt động trên khoản phí này) · 422 `IDEMPOTENCY_KEY_REUSED` · 500 `INTERNAL_ERROR` · 502 `OTP_SEND_FAILED` (giao dịch bị đánh dấu `FAILED`) · 503 `SERVICE_UNAVAILABLE` (auth hoặc tuition không gọi được) |
| `verify-and-pay` | 200 thành công · 400 `INVALID_REQUEST`, lỗi OTP (`OTP_EXPIRED`, `OTP_MISMATCH`, `OTP_ALREADY_USED`), `INSUFFICIENT_BALANCE` · 401 · 403 `FORBIDDEN` · 404 `TRANSACTION_NOT_FOUND`, `FEE_NOT_FOUND`, `OTP_NOT_FOUND`, `DEDUCT_FAILED` (user không còn tồn tại) · 409 `TRANSACTION_PROCESSING` / `_COMPLETED` / `_CANCELLED` / `_FAILED`, `ALREADY_PAID`, `CONCURRENCY_CONFLICT` · 500 `INTERNAL_ERROR`, `COMPENSATION_FAILED`, `COMPLETION_NOT_RECORDED` · 502 `DEDUCT_FAILED` · 503 `NOTIFICATION_UNAVAILABLE`, `TUITION_UNAVAILABLE` |
| `cancel` | 200 · 400 `INVALID_REQUEST` · 401 · 403 · 404 `TRANSACTION_NOT_FOUND` · 409 `INVALID_STATE_TRANSITION` (chỉ hủy được khi đang `PENDING_OTP`) · 500 |
| `resend-otp` | 200 · 400 `INVALID_REQUEST` · 401 · 403 · 404 `TRANSACTION_NOT_FOUND` · 409 `INVALID_STATE_TRANSITION` · 502 `OTP_SEND_FAILED` · 500 |
| `history` | 200 · 401 · 500 |

### Ghi chú hành vi
- **Initiate có idempotency:** cùng `Idempotency-Key` và cùng nội dung → trả lại đúng giao dịch cũ (`idempotent_replay: true`, kèm `transaction_status`, không gửi OTP mới). Cùng key khác nội dung → `422`. Được đảm bảo bằng `UNIQUE (user_id, idempotency_key)` nên retry song song cũng chỉ tạo một giao dịch.
- **Mỗi khoản phí chỉ một giao dịch hoạt động:** cột sinh tự động `active_fee_id` (chỉ có giá trị khi trạng thái là `PENDING_OTP` hoặc `PROCESSING`) có chỉ mục `UNIQUE`. Giao dịch `PENDING_OTP` quá 10 phút tự động chuyển `CANCELLED` ("Hết hạn chờ OTP") khi có thanh toán mới cho cùng khoản phí.
- **Luồng `verify-and-pay`:** khóa dòng (`FOR UPDATE`) và chuyển `PENDING_OTP → PROCESSING` → `POST /verify-otp` → `POST /internal/mark-paid` → `POST /internal/deduct` → `COMPLETED` → gửi biên lai (bất đồng bộ). Nhiều request đồng thời cho cùng một giao dịch: đúng một request được xử lý, các request còn lại nhận `409`.
- **Mọi lỗi sau khi vào `PROCESSING` đều kết thúc ở `FAILED`**, kể cả nhập OTP sai/hết hạn (nên mỗi giao dịch chỉ có một lần nhập OTP) và số dư không đủ. Response lỗi kèm `transaction_status: "FAILED"`. Nếu trừ tiền thất bại sau khi đã `mark-paid`, Saga gọi `POST /internal/revert-paid` trước khi đánh dấu giao dịch `FAILED`.
- Payment đọc `deduct.data.data.new_balance` (auth) và `otp.data.data.expires_in` (notification): **không đổi shape** các response này.

### Bảng `transactions` (payment_db) - cột snapshot
`payer_name`, `payer_email`, `student_name`, `type_of_fee` được ghi lúc `initiate` để làm biên lai / lịch sử / gửi lại OTP mà không phải gọi service khác. Không có khóa ngoại sang `users` / `tuition_fees`.

---

## Truy vết (`x-request-id`)

Mọi service nhận hoặc sinh `x-request-id` (8-64 ký tự gồm chữ, số, `.`, `_`, `-`), trả lại ở header phản hồi và ghi vào mỗi dòng log JSON. Payment truyền tiếp header này (cùng `x-internal-secret`) cho auth, tuition và notification, nên một thao tác của người dùng có cùng `requestId` trong log của mọi service liên quan.
