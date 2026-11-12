-- =========================================================================
-- 01 - auth-service sở hữu bảng users
-- =========================================================================
SET NAMES utf8mb4;
USE auth_db;

-- 1. BẢNG USERS: Lưu thông tin tài khoản iBanking và số dư tiền
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_balance_non_negative CHECK (balance >= 0)
) ENGINE=InnoDB;

-- Mật khẩu mặc định cho các tài khoản là: password123 (hoặc admin nếu username là admin)
INSERT INTO users (user_id, username, password_hash, full_name, phone_number, email, balance) VALUES
('ACC001', 'nguyenvana', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Nguyễn Văn A', '0912 345 678', 'nguyenvana.banking@gmail.com', 15000000.00),
('ACC002', 'tranthib', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Trần Thị B', '0987 654 321', 'tranthib.banking@gmail.com', 3500000.00),
('ACC003', 'lehoangc', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Lê Hoàng C', '0909 123 456', 'lehoangc.banking@gmail.com', 50000000.00),
('ACC004', 'phamminhd', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Phạm Minh D', '0933 111 222', 'phamminhd.banking@gmail.com', 20000000.00),
('ACC005', 'vothue', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Võ Thu E', '0944 333 444', 'vothue.banking@gmail.com', 8000000.00),
('ACC006', 'ngothif', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Ngô Thị F', '0955 555 666', 'ngothif.banking@gmail.com', 20000000.00),
('ACC000', 'admin', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Quản Trị Viên (Admin)', '0900 000 000', 'admin@ibanking.tdtu.edu.vn', 99999999.00)
ON DUPLICATE KEY UPDATE full_name=VALUES(full_name);
