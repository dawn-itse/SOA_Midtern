CREATE DATABASE IF NOT EXISTS ibanking_db 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE ibanking_db;

-- 1. BẢNG USERS: Lưu thông tin tài khoản iBanking và số dư tiền
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. BẢNG STUDENTS: Lưu thông tin sinh viên trường TDTU
CREATE TABLE IF NOT EXISTS students (
    student_id VARCHAR(20) PRIMARY KEY, -- MSSV (ví dụ: 524H0024)
    student_name VARCHAR(100) NOT NULL,
    faculty VARCHAR(100) NOT NULL,
    class_name VARCHAR(50) NOT NULL
) ENGINE=InnoDB;

-- 3. BẢNG TUITION_FEES: Lưu các khoản nợ học phí của sinh viên
CREATE TABLE IF NOT EXISTS tuition_fees (
    fee_id VARCHAR(50) PRIMARY KEY,
    student_id VARCHAR(20) NOT NULL,
    price DECIMAL(15, 2) NOT NULL,
    type_of_fee VARCHAR(150) NOT NULL,
    status ENUM('Chưa thanh toán', 'Đã thanh toán') DEFAULT 'Chưa thanh toán',
    description TEXT,
    expired_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. BẢNG TRANSACTIONS: Máy trạng thái FSM lưu lịch sử nộp tiền
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    fee_id VARCHAR(50) NOT NULL,
    student_id VARCHAR(20) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    status ENUM('PENDING_OTP', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING_OTP',
    failure_reason VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL
) ENGINE=InnoDB;

-- 5. BẢNG OTPS: Quản lý mã OTP 6 chữ số có hạn 5 phút
CREATE TABLE IF NOT EXISTS otps (
    otp_id VARCHAR(50) PRIMARY KEY,
    transaction_id VARCHAR(50) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    status ENUM('PENDING', 'VERIFIED', 'EXPIRED') DEFAULT 'PENDING',
    expired_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Mật khẩu mặc định cho các tài khoản là: password123 (hoặc admin nếu username là admin)
INSERT INTO users (user_id, username, password_hash, full_name, phone_number, email, balance) VALUES
('ACC001', 'nguyenvana', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Nguyễn Văn A', '0912 345 678', 'nguyenvana.banking@gmail.com', 15000000.00),
('ACC002', 'tranthib', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Trần Thị B', '0987 654 321', 'tranthib.banking@gmail.com', 3500000.00),
('ACC003', 'lehoangc', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Lê Hoàng C', '0909 123 456', 'lehoangc.banking@gmail.com', 50000000.00),
('ACC000', 'admin', '$2a$10$LdW0jf8HSFqcrB4007EQeOiXao.1RTM8A9ANhXgLYVTc/hXn78si.', 'Quản Trị Viên (Admin)', '0900 000 000', 'admin@ibanking.tdtu.edu.vn', 99999999.00)
ON DUPLICATE KEY UPDATE full_name=VALUES(full_name);

-- Sinh viên mẫu
INSERT INTO students (student_id, student_name, faculty, class_name) VALUES
('524H0129', 'Phùng Mau Tiến', 'Công nghệ Thông tin', '24H50201'),
('524H0024', 'Nguyễn Phong Phú', 'Công nghệ thông tin', '24H50201'),
('524H0041', 'Lê Quốc Tuấn', 'Ngoại ngữ Thương mạ   i', 'D21_NN03')
ON DUPLICATE KEY UPDATE student_name=VALUES(student_name);

-- Các khoản học phí
INSERT INTO tuition_fees (fee_id, student_id, price, type_of_fee, status, description, expired_at) VALUES
('FEE-2024-HK1-0089', '524H0129', 8500000.00, 'Học phí Học kỳ I (2024 - 2025)', 'Chưa thanh toán', 'Bao gồm 15 tín chỉ lý thuyết + 3 tín chỉ thực hành', '2026-10-15 23:59:59'),
('FEE-2024-LAB-0012', '524H0129', 1200000.00, 'Lệ phí Thực hành Lab Cloud & SOA', 'Chưa thanh toán', 'Chi phí máy chủ Cloud Lab & bản quyền phần mềm', '2026-10-20 23:59:59'),
('FEE-2024-BHYT-004', '524H0129', 893000.00, 'Bảo hiểm Y tế Sinh viên 2024', 'Đã thanh toán', 'Khoản phí Bảo hiểm y tế bắt buộc', '2024-08-30 23:59:59'),
('FEE-2024-HK1-0092', '524H0024', 12200000.00, 'Học phí Học kỳ I (2024 - 2025)', 'Chưa thanh toán', 'Học phí Khoa Tài chính Ngân hàng - 20 tín chỉ', '2026-10-20 23:59:59'),
('FEE-2024-TV-0088', '524H0024', 600000.00, 'Phí Thư viện Digital & Giáo trình', 'Chưa thanh toán', 'Quyền truy cập thư viện số toàn cầu', '2026-10-25 23:59:59'),
('FEE-2024-HK1-0104', '524H0041', 5400000.00, 'Học phí Học kỳ I (2024 - 2025)', 'Chưa thanh toán', 'Học phí Khóa học Ngoại ngữ Tiếng Anh Chuyên ngành', '2026-10-25 23:59:59')
ON DUPLICATE KEY UPDATE price=VALUES(price);
