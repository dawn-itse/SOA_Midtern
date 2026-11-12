-- =========================================================================
-- 02 - tuition-service sở hữu bảng students, tuition_fees
-- =========================================================================
SET NAMES utf8mb4;
USE tuition_db;

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
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    CONSTRAINT chk_fee_price_positive CHECK (price > 0)
) ENGINE=InnoDB;

-- Sinh viên mẫu
INSERT INTO students (student_id, student_name, faculty, class_name) VALUES
('524H0129', 'Phùng Mau Tiến', 'Công nghệ Thông tin', '24H50201'),
('524H0024', 'Nguyễn Phong Phú', 'Công nghệ thông tin', '24H50201'),
('524H0041', 'Lê Quốc Tuấn', 'Ngoại ngữ Thương mại', 'D21_NN03')
ON DUPLICATE KEY UPDATE student_name=VALUES(student_name), faculty=VALUES(faculty);

-- Các khoản học phí
INSERT INTO tuition_fees (fee_id, student_id, price, type_of_fee, status, description, expired_at) VALUES
('FEE-2024-HK1-0089', '524H0129', 8500000.00, 'Học phí Học kỳ I (2024 - 2025)', 'Chưa thanh toán', 'Bao gồm 15 tín chỉ lý thuyết + 3 tín chỉ thực hành', '2026-10-15 23:59:59'),
('FEE-2024-LAB-0012', '524H0129', 1200000.00, 'Lệ phí Thực hành Lab Cloud & SOA', 'Chưa thanh toán', 'Chi phí máy chủ Cloud Lab & bản quyền phần mềm', '2026-10-20 23:59:59'),
('FEE-2024-BHYT-004', '524H0129', 893000.00, 'Bảo hiểm Y tế Sinh viên 2024', 'Đã thanh toán', 'Khoản phí Bảo hiểm y tế bắt buộc', '2024-08-30 23:59:59'),
('FEE-2024-HK1-0092', '524H0024', 12200000.00, 'Học phí Học kỳ I (2024 - 2025)', 'Chưa thanh toán', 'Học phí Khoa Tài chính Ngân hàng - 20 tín chỉ', '2026-10-20 23:59:59'),
('FEE-2024-TV-0088', '524H0024', 600000.00, 'Phí Thư viện Digital & Giáo trình', 'Chưa thanh toán', 'Quyền truy cập thư viện số toàn cầu', '2026-10-25 23:59:59'),
('FEE-2024-HK1-0104', '524H0041', 5400000.00, 'Học phí Học kỳ I (2024 - 2025)', 'Chưa thanh toán', 'Học phí Khóa học Ngoại ngữ Tiếng Anh Chuyên ngành', '2026-10-25 23:59:59')
ON DUPLICATE KEY UPDATE price=VALUES(price);
