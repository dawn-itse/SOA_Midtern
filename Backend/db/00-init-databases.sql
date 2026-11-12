-- =========================================================================
-- 00 - Tạo 4 database (database-per-service) + 4 MySQL user riêng
-- Mỗi user chỉ có quyền trên database của chính service đó.
-- =========================================================================
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS auth_db         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS tuition_db      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS payment_db      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS notification_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'auth_user'@'%'         IDENTIFIED BY 'auth_pass';
CREATE USER IF NOT EXISTS 'tuition_user'@'%'      IDENTIFIED BY 'tuition_pass';
CREATE USER IF NOT EXISTS 'payment_user'@'%'      IDENTIFIED BY 'payment_pass';
CREATE USER IF NOT EXISTS 'notification_user'@'%' IDENTIFIED BY 'notification_pass';

GRANT ALL PRIVILEGES ON auth_db.*         TO 'auth_user'@'%';
GRANT ALL PRIVILEGES ON tuition_db.*      TO 'tuition_user'@'%';
GRANT ALL PRIVILEGES ON payment_db.*      TO 'payment_user'@'%';
GRANT ALL PRIVILEGES ON notification_db.* TO 'notification_user'@'%';
FLUSH PRIVILEGES;
