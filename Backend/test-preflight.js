// Kiểm tra stack đang chạy trước khi test; thiếu thì báo rõ ràng và thoát (mã 1).
const SERVICES = { 'auth-service': 8001, 'tuition-service': 8002, 'payment-service': 8003, 'notification-service': 8004 };

export async function preflight({ db } = {}) {
  const down = [];
  for (const [name, port] of Object.entries(SERVICES)) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) down.push(`${name} (cổng ${port}, HTTP ${r.status})`);
    } catch {
      down.push(`${name} (cổng ${port}, không kết nối được)`);
    }
  }
  let dbErr = null;
  if (db) {
    try { await db.query('SELECT 1'); } catch (e) { dbErr = e.message; }
  }
  if (down.length || dbErr) {
    console.error('\n[LỖI] Hệ thống chưa sẵn sàng để chạy test:');
    down.forEach((d) => console.error(`  - ${d}`));
    if (dbErr) console.error(`  - MySQL (DB_HOST/DB_PORT, mặc định localhost:3307): ${dbErr}`);
    console.error('\nHãy khởi động hệ thống trước: docker compose up -d --build   (hoặc start-all.bat), đợi các service healthy rồi chạy lại.');
    process.exit(1);
  }
}
