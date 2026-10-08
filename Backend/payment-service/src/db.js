import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'ibanking_db',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  decimalNumbers: true
});

// Hàm kiểm tra kết nối CSDL lúc khởi động server
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('[Payment Service] Kết nối cơ sở dữ liệu MySQL thành công!');
    connection.release();
    return true;
  } catch (error) {
    console.error('[Payment Service] Lỗi kết nối MySQL:', error.message);
    return false;
  }
}
