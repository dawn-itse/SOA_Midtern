// =========================================================================
// FILE: init-db.js - TỰ ĐỘNG NẠP BẢNG VÀ DỮ LIỆU TỪ database.sql VÀO MYSQL
// =========================================================================

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setupDatabase() {
  console.log('🔄 Đang kết nối MySQL để tạo bảng...');

  try {
    // 1. Kết nối tới MySQL cho phép chạy nhiều câu lệnh cùng lúc (multipleStatements: true)
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'password',
      multipleStatements: true
    });

    // 2. Đọc nội dung file database.sql (nằm ở thư mục cha Backend/)
    const sqlPath = path.resolve(__dirname, '../database.sql');
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Không tìm thấy file database.sql tại: ${sqlPath}`);
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // 3. Thực thi toàn bộ các câu lệnh tạo bảng và seed data
    console.log('🔄 Đang thực thi các câu lệnh SQL...');
    await connection.query(sqlContent);

    console.log('\n=============================================================');
    console.log('  ✅ THÀNH CÔNG! ĐÃ TẠO XONG TẤT CẢ CÁC BẢNG & DỮ LIỆU MẪU:  ');
    console.log('  - Bảng: users (nguyenvana, admin, tranthib, lehoangc)');
    console.log('  - Bảng: students (524H0024, 524H0129, 524H0041)');
    console.log('  - Bảng: tuition_fees (Học phí kỳ 1, Lab, BHYT)');
    console.log('  - Bảng: transactions, otps');
    console.log('=============================================================\n');

    await connection.end();
  } catch (error) {
    console.error('❌ Lỗi nạp Database:', error.message);
  }
}

setupDatabase();
