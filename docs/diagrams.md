# Sơ đồ thiết kế (Mermaid)

Các sơ đồ dưới đây viết bằng Mermaid: xem trực tiếp trên GitHub / VS Code (extension *Markdown Preview Mermaid Support*),
hoặc dán code vào https://mermaid.live để **xuất PNG/SVG** đưa vào báo cáo. Gợi ý lưu ảnh vào `docs/use-case.png`,
`docs/erd.png`, `docs/architecture.png`.

## 1. Use Case Diagram

Actor: **Người nộp tiền** (người dùng iBanking) và **Hệ thống Email** (SMTP, external service). Notification Service gửi mail OTP / biên lai.

```mermaid
flowchart LR
  U(["Người nộp tiền<br/>(người dùng iBanking)"])
  M(["Hệ thống Email<br/>(SMTP / Mailpit)"])

  subgraph SYS["Hệ thống iBanking đóng học phí"]
    UC1([Đăng nhập])
    UC2([Xem thông tin tài khoản và số dư])
    UC3([Tra cứu học phí theo MSSV])
    UC4([Khởi tạo giao dịch thanh toán])
    UC5([Xác thực OTP và thanh toán])
    UC6([Gửi lại OTP])
    UC7([Hủy giao dịch đang chờ OTP])
    UC8([Xem lịch sử giao dịch / biên lai])
    UC9([Gửi email OTP])
    UC10([Gửi email xác nhận biên lai])
  end

  U --- UC1
  U --- UC2
  U --- UC3
  U --- UC4
  U --- UC5
  U --- UC6
  U --- UC7
  U --- UC8
  UC4 -. include .-> UC9
  UC6 -. include .-> UC9
  UC5 -. include .-> UC10
  UC9 --- M
  UC10 --- M
```

## 2. ERD (4 database, database-per-service)

Mỗi service sở hữu một database riêng trên cùng một MySQL server. **Không có khóa ngoại giữa các database**: các quan hệ nối
liền bên dưới là quan hệ logic, được đảm bảo ở tầng ứng dụng (payment gọi API của auth/tuition; bảng `transactions` lưu thêm
các cột snapshot để tra lịch sử mà không truy vấn chéo).

```mermaid
erDiagram
  USERS {
    varchar user_id PK
    varchar username UK
    varchar password_hash
    varchar full_name
    varchar phone_number
    varchar email
    decimal balance "CHECK balance >= 0"
    datetime created_at
  }
  STUDENTS {
    varchar student_id PK "MSSV"
    varchar student_name
    varchar faculty
    varchar class_name
  }
  TUITION_FEES {
    varchar fee_id PK
    varchar student_id FK
    decimal price "CHECK price > 0"
    varchar type_of_fee
    enum status "Chưa thanh toán / Đã thanh toán"
    varchar description
    datetime expired_at
  }
  TRANSACTIONS {
    varchar transaction_id PK
    varchar user_id "tham chiếu logic USERS"
    varchar fee_id "tham chiếu logic TUITION_FEES"
    varchar student_id
    decimal amount "CHECK amount > 0"
    enum status "PENDING_OTP / PROCESSING / COMPLETED / FAILED / CANCELLED"
    varchar failure_reason
    varchar payer_name "snapshot"
    varchar payer_email "snapshot"
    varchar student_name "snapshot"
    varchar type_of_fee "snapshot"
    varchar idempotency_key "UNIQUE (user_id, key)"
    datetime created_at
    datetime completed_at
  }
  OTPS {
    varchar otp_id PK
    varchar transaction_id "tham chiếu logic TRANSACTIONS"
    varchar otp_code
    enum status "PENDING / VERIFIED / EXPIRED"
    datetime expired_at
    datetime created_at
  }

  STUDENTS ||--o{ TUITION_FEES : "có"
  USERS ||..o{ TRANSACTIONS : "thực hiện (logic, khác database)"
  TUITION_FEES ||..o{ TRANSACTIONS : "được thanh toán bởi (logic)"
  TRANSACTIONS ||..o{ OTPS : "có OTP (logic)"
```

| Database | Service sở hữu | Bảng |
|---|---|---|
| `auth_db` | auth-service | `users` |
| `tuition_db` | tuition-service | `students`, `tuition_fees` |
| `payment_db` | payment-service | `transactions` |
| `notification_db` | notification-service | `otps` |

## 3. Microservices Architecture Diagram

```mermaid
flowchart TB
  B["Trình duyệt<br/>React + Vite (nginx :5173)"]
  GW["API Gateway (nginx :8000)<br/>định tuyến, rate limit, x-request-id<br/>chặn /internal và notification"]

  subgraph NET["Mạng Docker nội bộ"]
    AUTH["auth-service :8001<br/>đăng nhập (JWT), số dư,<br/>trừ tiền (FOR UPDATE)"]
    TUI["tuition-service :8002<br/>sinh viên, học phí,<br/>gạch nợ có điều kiện"]
    PAY["payment-service :8003<br/>orchestrator: FSM + Saga,<br/>lịch sử, idempotency"]
    NOTI["notification-service :8004<br/>sinh / xác thực OTP,<br/>gửi email OTP và biên lai"]
    DB[("MySQL 8 :3307<br/>auth_db | tuition_db | payment_db | notification_db<br/>mỗi service 1 user riêng")]
  end

  SMTP["SMTP: Mailpit :8025<br/>hoặc Gmail (external service)"]
  SW["Swagger UI :8080<br/>OpenAPI 4 service"]

  B -->|"HTTPS/JSON + JWT"| GW
  GW -->|"/api/auth"| AUTH
  GW -->|"/api/tuition"| TUI
  GW -->|"/api/payment"| PAY
  PAY -->|"x-internal-secret<br/>/internal/users, /internal/deduct"| AUTH
  PAY -->|"x-internal-secret<br/>/internal/fees, mark-paid, revert-paid"| TUI
  PAY -->|"x-internal-secret<br/>send-otp, verify-otp, cancel-otp, send-receipt"| NOTI
  AUTH --- DB
  TUI --- DB
  PAY --- DB
  NOTI --- DB
  NOTI -->|SMTP| SMTP
  SW -. đặc tả .-> GW
```

**Lý do chọn kiến trúc**
- Tách theo nghiệp vụ: tài khoản/số dư, học phí, điều phối thanh toán, thông báo OTP. Mỗi service có database và quyền MySQL riêng (data ownership rõ ràng).
- `payment-service` là orchestrator duy nhất: chỉ nó gọi các service khác; frontend không bao giờ gọi API nội bộ.
- Giao tiếp đồng bộ REST/JSON (đơn giản, dễ demo, dễ test). Hệ quả: cần Saga bù hoàn khi trừ tiền thất bại sau khi đã gạch nợ.
- 1 MySQL server, 4 database: nhẹ cho demo trên một máy nhưng vẫn tách ranh giới dữ liệu bằng quyền truy cập.
- API Gateway là điểm vào duy nhất: gom URL, rate limit, truy vết, và không lộ API nội bộ ra ngoài.

## 4. Sequence: thanh toán học phí

```mermaid
sequenceDiagram
  autonumber
  actor U as Người nộp tiền
  participant FE as Frontend
  participant GW as API Gateway
  participant P as payment-service
  participant A as auth-service
  participant T as tuition-service
  participant N as notification-service
  participant M as SMTP/Mailpit

  U->>FE: Đăng nhập, tra cứu MSSV, chọn khoản học phí
  FE->>GW: POST /api/payment/initiate (JWT, Idempotency-Key)
  GW->>P: chuyển tiếp + x-request-id
  P->>A: GET /internal/users/{id} (số dư, email)
  P->>T: GET /internal/fees/{id} (giá, trạng thái)
  P->>P: tạo giao dịch PENDING_OTP
  P->>N: POST /send-otp
  N->>M: email OTP
  P-->>FE: 200 transaction_id
  U->>FE: nhập OTP
  FE->>GW: POST /api/payment/verify-and-pay
  GW->>P: chuyển tiếp
  P->>P: khóa dòng giao dịch, PENDING_OTP đến PROCESSING
  P->>N: POST /verify-otp (dùng một lần, còn hạn)
  P->>T: POST /internal/mark-paid (gạch nợ có điều kiện)
  P->>A: POST /internal/deduct (SELECT FOR UPDATE, trừ tiền)
  alt trừ tiền thành công
    P->>P: PROCESSING đến COMPLETED
    P->>N: POST /send-receipt
    N->>M: email biên lai
    P-->>FE: 200 COMPLETED, số dư mới
  else trừ tiền thất bại (hết tiền, lỗi mạng)
    P->>T: POST /internal/revert-paid (Saga bù hoàn, retry 3 lần)
    P->>P: PROCESSING đến FAILED
    P-->>FE: 400/5xx kèm mã lỗi
  end
```

## 5. Máy trạng thái giao dịch (FSM)

```mermaid
stateDiagram-v2
  [*] --> PENDING_OTP: initiate (đã gửi OTP)
  PENDING_OTP --> PROCESSING: verify-and-pay (giành khóa dòng)
  PENDING_OTP --> CANCELLED: cancel
  PENDING_OTP --> FAILED: gửi OTP lỗi
  PROCESSING --> COMPLETED: gạch nợ và trừ tiền thành công
  PROCESSING --> FAILED: OTP sai/hết hạn, hết tiền, học phí đã được trả (Saga bù hoàn)
  COMPLETED --> [*]
  FAILED --> [*]
  CANCELLED --> [*]
```

## 6. Hai tình huống concurrency và cách xử lý

| Tình huống | Rủi ro | Cơ chế |
|---|---|---|
| **A.** Một tài khoản thanh toán đồng thời nhiều khoản | Chi tiêu vượt số dư (double spending) | auth-service: `SELECT ... FOR UPDATE` khóa dòng `users`, kiểm tra `balance >= amount` và `UPDATE balance = balance - ?` trong cùng transaction; thêm `CHECK (balance >= 0)`. Giao dịch hết tiền bị từ chối, Saga hoàn tác gạch nợ |
| **B.** Nhiều tài khoản cùng thanh toán một khoản học phí | Một khoản học phí bị trả hai lần | tuition-service: `UPDATE ... SET status = 'Đã thanh toán' WHERE fee_id = ? AND status = 'Chưa thanh toán'`; chỉ request đầu có `affectedRows = 1`, các request sau nhận 409 `ALREADY_PAID` |
| Gửi trùng cùng một giao dịch | Xử lý hai lần | payment-service: `SELECT ... FOR UPDATE` trên dòng giao dịch và FSM; chỉ một request chuyển được `PENDING_OTP` sang `PROCESSING` |
| Retry `initiate` | Tạo giao dịch trùng | `Idempotency-Key` + `UNIQUE (user_id, idempotency_key)` |
