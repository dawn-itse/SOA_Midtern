// =========================================================================
// FILE: src/db.js - Quản lý kết nối MySQL cho Notification Service (Port 8004)
// =========================================================================

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// Tạo bể kết nối (Connection Pool) để đọc và lưu mã OTP vào bảng otps
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'ibanking_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('[Notification Service] Đã kết nối thành công tới MySQL Database');
    connection.release();
  } catch (error) {
    console.error('[Notification Service] Lỗi kết nối MySQL:', error.message);
  }
}
