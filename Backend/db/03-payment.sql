-- =========================================================================
-- 03 - payment-service sở hữu bảng transactions (FSM lưu lịch sử nộp tiền)
-- Không có khóa ngoại sang users / tuition_fees (nằm ở database khác).
-- Các cột snapshot giúp payment làm biên lai / lịch sử / gửi lại OTP mà không phải gọi service khác.
-- =========================================================================
SET NAMES utf8mb4;
USE payment_db;

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    fee_id VARCHAR(50) NOT NULL,
    student_id VARCHAR(20) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    status ENUM('PENDING_OTP', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING_OTP',
    failure_reason VARCHAR(255) NULL,
    payer_name VARCHAR(100) NOT NULL,
    payer_email VARCHAR(100) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    type_of_fee VARCHAR(150) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    -- Idempotency-Key của request initiate (NULL nếu client không gửi). UNIQUE theo (user, key): gửi lại cùng key không tạo giao dịch mới
    idempotency_key VARCHAR(64) NULL,
    active_fee_id VARCHAR(50) GENERATED ALWAYS AS (IF(status IN ('PENDING_OTP','PROCESSING'), fee_id, NULL)) STORED,
    -- Không có FK chéo database -> dùng CHECK + index
    CONSTRAINT chk_txn_amount_positive CHECK (amount > 0),
    INDEX idx_txn_user_created (user_id, created_at),  -- lịch sử giao dịch theo người dùng
    INDEX idx_txn_fee (fee_id),
    INDEX idx_txn_status (status),
    UNIQUE KEY uq_txn_user_idem (user_id, idempotency_key),
    UNIQUE KEY uq_txn_active_fee (active_fee_id)
) ENGINE=InnoDB;
