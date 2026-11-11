import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  decimalNumbers: true,
  charset: 'utf8mb4'
});
// Hàm kiểm tra kết nối CSDL lúc khởi động server

export async function testConnection() {
  try {
    const connection = await pool.getConnection(); 
    console.log(' Kết nối cơ sở dữ liệu MySQL thành công!');
    connection.release();
    return true;
  } catch (error) {
    console.error(' Lỗi kết nối MySQL:', error.message);
    return false;
  }
}
