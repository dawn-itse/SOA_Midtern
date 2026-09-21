// =========================================================================
// FILE: src/db.js - KẾT NỐI CƠ SỞ DỮ LIỆU MYSQL (PAYMENT SERVICE)
// =========================================================================

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Tạo bể kết nối (Connection Pool) tới cơ sở dữ liệu ibanking_db
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'ibanking_db',
  waitForConnections: true,
  connectionLimit: 15, // Cho phép 15 kết nối đồng thời để xử lý thanh toán song song
  queueLimit: 0
});

// Hàm kiểm tra kết nối CSDL lúc khởi động server
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('[Payment Service] Kết nối cơ sở dữ liệu MySQL thành công!');
    connection.release(); // Trả kết nối lại cho bể
    return true;
  } catch (error) {
    console.error('[Payment Service] Lỗi kết nối MySQL:', error.message);
    return false;
  }
}
