-- =========================================================================
-- 04 - notification-service sở hữu bảng otps (OTP 6 số, hạn 5 phút)
-- Không có khóa ngoại tới transactions (nằm ở payment_db).
-- =========================================================================
SET NAMES utf8mb4;
USE notification_db;

CREATE TABLE IF NOT EXISTS otps (
    otp_id VARCHAR(50) PRIMARY KEY,
    transaction_id VARCHAR(50) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    status ENUM('PENDING', 'VERIFIED', 'EXPIRED') DEFAULT 'PENDING',
    expired_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_otps_txn (transaction_id)
) ENGINE=InnoDB;
