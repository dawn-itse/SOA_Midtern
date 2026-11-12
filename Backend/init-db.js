// =========================================================================
// Backend/init-db.js - NẠP 4 DATABASE CHO CHẠY LOCAL (KHÔNG DÙNG DOCKER)
// Chạy lần lượt Backend/db/00..04-*.sql bằng tài khoản root.
//   node Backend/init-db.js
// Biến môi trường (tùy chọn): DB_HOST, DB_PORT, DB_ROOT_USER, DB_ROOT_PASSWORD
// =========================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));

const files = fs.readdirSync(path.join(here, 'db')).filter((f) => /^\d\d-.*\.sql$/.test(f)).sort();

async function main() {
  console.log('Bước 1/2: kết nối MySQL bằng tài khoản root...');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_ROOT_USER || 'root',
    password: process.env.DB_ROOT_PASSWORD || 'password',
    multipleStatements: true,
    charset: 'utf8mb4'
  });
  console.log('  Kết nối thành công.');
  console.log(`Bước 2/2: chạy ${files.length} file SQL trong Backend/db/`);
  try {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(here, 'db', f), 'utf8');
      process.stdout.write(`  - ${f} ... `);
      await conn.query(sql);
      console.log('OK');
    }
  } finally {
    await conn.end();
  }
  console.log('Hoàn tất: đã tạo auth_db, tuition_db, payment_db, notification_db và 4 MySQL user riêng.');
}

main().catch((e) => {
  console.error('\nLỗi nạp database:', e.message);
  process.exit(1);
});
