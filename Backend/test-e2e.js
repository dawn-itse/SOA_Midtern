// =====================================================================================================
// E2E TEST: đi qua API GATEWAY (http://localhost:8000) đúng như frontend, toàn bộ luồng chính:
//   đăng nhập -> tra cứu học phí -> initiate (Idempotency-Key) -> OTP (email) -> thanh toán -> lịch sử -> biên lai
// kèm kiểm tra: gateway chặn API nội bộ, truyền x-request-id, idempotency, replay sau khi hoàn tất.
// Yêu cầu: stack Docker đang chạy (docker compose up -d --build). Chạy: cd Backend && npm run test:e2e
// Test tự khôi phục dữ liệu (học phí, số dư, giao dịch/OTP test) khi kết thúc; KEEP_TEST_DATA=1 để giữ lại.
// =====================================================================================================
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { preflight } from './test-preflight.js';

const GW = process.env.GATEWAY_URL || 'http://localhost:8000';
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';
const INTERNAL = process.env.INTERNAL_API_SECRET || 'soa_internal_secret';
const FEE = 'FEE-2024-HK1-0104', STUDENT = '524H0041', PRICE = 5400000; // học phí 5.4tr của sinh viên 524H0041
const USER = { username: 'lehoangc', id: 'ACC003', email: 'lehoangc.banking@gmail.com' };

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3307'),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'password',
  decimalNumbers: true, multipleStatements: false
});
const q = async (sql, p) => (await db.query(sql, p))[0];

let passed = 0, total = 0, skipped = 0;
const assert = (cond, name) => { total++; if (cond) { passed++; console.log(`  [PASS] ${name}`); } else console.log(`  [FAIL] ${name}`); };
const eq = (a, b) => Math.round(a * 100) === Math.round(b * 100); // so sánh tiền chính xác tới xu
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body, headers = {} } = {}) {
  const r = await fetch(`${GW}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) };
}

// --- Mailpit: bỏ qua (SKIP) nếu hệ thống không gửi mail qua Mailpit ---
async function mailpitUsable() {
  try {
    const h = await (await fetch('http://localhost:8004/health')).json();
    if (h.mailMode !== 'smtp') return 'notification đang ở chế độ simulator';
    if (h.mailOverride) return 'đang dùng MAIL_TO_OVERRIDE (mail đi tới hộp thư thật)';
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=1`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? null : `Mailpit trả HTTP ${r.status}`;
  } catch { return `không kết nối được Mailpit tại ${MAILPIT}`; }
}
async function findMail(match) {
  for (let i = 0; i < 10; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json()).messages || [];
    for (const m of list) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      if (match(full)) return full;
    }
    await sleep(500);
  }
  return null;
}
const mailTo = (m, a) => (m.To || []).some((t) => (t.Address || '').toLowerCase() === a.toLowerCase());

async function main() {
  await preflight({ db });
  try { await fetch(`${GW}/health`, { signal: AbortSignal.timeout(3000) }); } catch {
    console.error(`\n[LỖI] Không kết nối được API Gateway tại ${GW}. Chạy: docker compose up -d --build`); process.exit(1);
  }

  const bBefore = (await q('SELECT balance FROM auth_db.users WHERE user_id = ?', [USER.id]))[0].balance;
  const feeBefore = (await q('SELECT status FROM tuition_db.tuition_fees WHERE fee_id = ?', [FEE]))[0].status;
  await q("UPDATE tuition_db.tuition_fees SET status = 'Chưa thanh toán' WHERE fee_id = ?", [FEE]);
  const idemKey = `e2e-${crypto.randomUUID()}`;
  let txn = null;

  try {
    // ------------------------------------------------------------------ API GATEWAY
    console.log('\n--- API GATEWAY ---');
    let r = await call('GET', '/health');
    assert(r.status === 200 && r.data.service === 'api-gateway', 'G1. Gateway /health hoạt động');
    r = await call('GET', `/internal/users/${USER.id}`, { headers: { 'x-internal-secret': INTERNAL } });
    assert(r.status === 404 && r.data.code === 'ROUTE_NOT_FOUND', 'G2. Gateway KHÔNG công khai /internal/* (dù có secret đúng) -> 404');
    r = await call('POST', '/send-otp', { body: { transaction_id: 'T', email: 'a@a.a', amount: 1 }, headers: { 'x-internal-secret': INTERNAL } });
    assert(r.status === 404, 'G3. Gateway KHÔNG công khai notification-service (/send-otp) -> 404');
    const rid = `e2e-trace-${Date.now()}`;
    r = await call('POST', '/api/auth/login', { body: { username: 'khong-ton-tai', password: 'x' }, headers: { 'x-request-id': rid } });
    assert(r.status === 401 && r.headers.get('x-request-id') === rid, 'G4. x-request-id của client đi qua gateway -> auth-service và được trả về nguyên vẹn');
    r = await call('POST', '/api/auth/login', { body: { username: 'khong-ton-tai', password: 'x' } });
    assert(/^[\w.-]{8,64}$/.test(r.headers.get('x-request-id') || ''), 'G5. Không gửi x-request-id: gateway tự sinh mã truy vết');

    // ------------------------------------------------------------------ ĐĂNG NHẬP, TÀI KHOẢN, TRA CỨU
    console.log('\n--- LUỒNG CHÍNH: ĐĂNG NHẬP -> TRA CỨU ---');
    r = await call('POST', '/api/auth/login', { body: { username: USER.username, password: 'password123' } });
    const token = r.data?.data?.token;
    assert(r.status === 200 && !!token, 'E1. Đăng nhập qua gateway nhận JWT');
    r = await call('GET', '/api/auth/profile', { token });
    assert(r.status === 200 && eq(r.data.data.balance, bBefore), 'E2. Xem thông tin tài khoản và số dư');
    r = await call('GET', `/api/tuition/students/${STUDENT}`, { token });
    const feeRow = r.data?.data?.student?.fees?.find((f) => f.feeId === FEE);
    assert(r.status === 200 && feeRow?.status === 'Chưa thanh toán' && feeRow?.price === PRICE, 'E3. Tra cứu MSSV: thấy khoản học phí chưa thanh toán');

    // ------------------------------------------------------------------ INITIATE + IDEMPOTENCY
    console.log('\n--- KHỞI TẠO THANH TOÁN & IDEMPOTENCY ---');
    const body = { fee_id: FEE, student_id: STUDENT, amount: PRICE };
    r = await call('POST', '/api/payment/initiate', { token, body, headers: { 'Idempotency-Key': idemKey } });
    txn = r.data.transaction_id;
    assert(r.status === 200 && /^TXN-/.test(txn || '') && !r.data.idempotent_replay, 'E4. initiate (có Idempotency-Key) -> tạo giao dịch PENDING_OTP và gửi OTP');
    const otpCount1 = (await q('SELECT COUNT(*) AS c FROM notification_db.otps WHERE transaction_id = ?', [txn]))[0].c;
    r = await call('POST', '/api/payment/initiate', { token, body, headers: { 'Idempotency-Key': idemKey } });
    assert(r.status === 200 && r.data.idempotent_replay === true && r.data.transaction_id === txn, 'I1. Gửi lại cùng Idempotency-Key -> nhận lại ĐÚNG giao dịch cũ (idempotent_replay)');
    const nTxn = (await q('SELECT COUNT(*) AS c FROM payment_db.transactions WHERE idempotency_key = ?', [idemKey]))[0].c;
    const otpCount2 = (await q('SELECT COUNT(*) AS c FROM notification_db.otps WHERE transaction_id = ?', [txn]))[0].c;
    assert(nTxn === 1 && otpCount1 === 1 && otpCount2 === 1, 'I2. Không tạo giao dịch mới và không gửi thêm OTP khi replay');
    r = await call('POST', '/api/payment/initiate', { token, body: { fee_id: 'FEE-2024-TV-0088', student_id: '524H0024', amount: 600000 }, headers: { 'Idempotency-Key': idemKey } });
    assert(r.status === 422 && r.data.code === 'IDEMPOTENCY_KEY_REUSED', 'I3. Cùng key nhưng nội dung khác -> 422 IDEMPOTENCY_KEY_REUSED');
    r = await call('POST', '/api/payment/initiate', { token, body, headers: { 'Idempotency-Key': 'ngan' } });
    assert(r.status === 400 && r.data.code === 'INVALID_IDEMPOTENCY_KEY', 'I4. Idempotency-Key sai định dạng -> 400');
    // Gửi song song 5 request cùng key (cạnh tranh ở UNIQUE KEY): vẫn chỉ có 1 giao dịch
    const key2 = `e2e-par-${crypto.randomUUID()}`;
    await call('POST', '/api/payment/cancel', { token, body: { transaction_id: txn } }); // hủy giao dịch trên để khoản học phí không bị giữ chỗ
    const par = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/payment/initiate', { token, body, headers: { 'Idempotency-Key': key2 } })));
    const ids = new Set(par.filter((x) => x.status === 200).map((x) => x.data.transaction_id));
    const nPar = (await q('SELECT COUNT(*) AS c FROM payment_db.transactions WHERE idempotency_key = ?', [key2]))[0].c;
    assert(par.every((x) => x.status === 200) && ids.size === 1 && nPar === 1, 'I5. 5 request song song cùng Idempotency-Key -> cùng 1 giao dịch, DB chỉ có 1 dòng');
    txn = [...ids][0]; // dùng giao dịch này cho phần thanh toán bên dưới

    // ------------------------------------------------------------------ OTP QUA EMAIL
    console.log('\n--- OTP QUA EMAIL ---');
    const otp = (await q("SELECT otp_code FROM notification_db.otps WHERE transaction_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1", [txn]))[0]?.otp_code;
    assert(/^\d{6}$/.test(otp || ''), 'O1. OTP 6 chữ số được sinh và gắn với giao dịch');
    const mailWhy = await mailpitUsable();
    if (mailWhy) { skipped++; console.log(`  [SKIP] O2. Mail OTP trong Mailpit (${mailWhy})`); }
    else {
      const m = await findMail((x) => mailTo(x, USER.email) && /OTP/.test(x.Subject || '') && (x.Text || x.HTML || '').includes(otp));
      assert(!!m, 'O2. Email OTP tới đúng người dùng, mã trong mail khớp OTP trong DB');
    }

    // ------------------------------------------------------------------ THANH TOÁN
    console.log('\n--- THANH TOÁN, LỊCH SỬ, BIÊN LAI ---');
    r = await call('POST', '/api/payment/verify-and-pay', { token, body: { transaction_id: txn, otp_code: otp } });
    assert(r.status === 200 && r.data.data.status === 'COMPLETED' && eq(r.data.data.newBalance, bBefore - PRICE), 'E5. verify-and-pay -> COMPLETED, trả số dư mới');
    r = await call('GET', '/api/auth/profile', { token });
    assert(eq(r.data.data.balance, bBefore - PRICE), 'E6. Số dư trong profile đã bị trừ đúng số tiền');
    r = await call('GET', `/api/tuition/students/${STUDENT}`, { token });
    assert(r.data.data.student.fees.find((f) => f.feeId === FEE)?.status === 'Đã thanh toán', 'E7. Học phí được gạch nợ (Đã thanh toán)');
    r = await call('GET', '/api/payment/history', { token });
    const h = (r.data.data || []).find((x) => x.transactionId === txn);
    assert(r.status === 200 && h?.status === 'COMPLETED' && h?.amount === PRICE, 'E8. Lịch sử giao dịch có giao dịch vừa thanh toán (COMPLETED)');
    if (mailWhy) { skipped++; console.log(`  [SKIP] E9. Mail biên lai trong Mailpit (${mailWhy})`); }
    else {
      const rc = await findMail((x) => mailTo(x, USER.email) && (x.Subject || '').includes(txn));
      assert(!!rc, 'E9. Email biên lai xác nhận được gửi sau khi thanh toán thành công');
    }

    // ------------------------------------------------------------------ SAU KHI HOÀN TẤT
    console.log('\n--- SAU KHI HOÀN TẤT: REPLAY & DÙNG LẠI OTP ---');
    r = await call('POST', '/api/payment/verify-and-pay', { token, body: { transaction_id: txn, otp_code: otp } });
    const bAfter = (await q('SELECT balance FROM auth_db.users WHERE user_id = ?', [USER.id]))[0].balance;
    assert(r.status === 409 && eq(bAfter, bBefore - PRICE), 'R1. Dùng lại OTP/giao dịch đã COMPLETED -> 409, KHÔNG trừ tiền lần nữa');
    r = await call('POST', '/api/payment/initiate', { token, body, headers: { 'Idempotency-Key': key2 } });
    assert(r.status === 200 && r.data.idempotent_replay === true && r.data.transaction_status === 'COMPLETED', 'R2. Replay initiate sau khi hoàn tất: trả lại giao dịch COMPLETED, không tạo giao dịch mới');
    r = await call('POST', '/api/payment/initiate', { token, body });
    assert(r.status === 409 && r.data.code === 'ALREADY_PAID', 'R3. Khởi tạo thanh toán lại khoản đã đóng (không key) -> 409 ALREADY_PAID');
  } finally {
    if (!process.env.KEEP_TEST_DATA) {
      const ids = (await q("SELECT transaction_id FROM payment_db.transactions WHERE idempotency_key LIKE 'e2e-%'")).map((x) => x.transaction_id);
      if (ids.length) {
        await q('DELETE FROM notification_db.otps WHERE transaction_id IN (?)', [ids]);
        await q('DELETE FROM payment_db.transactions WHERE transaction_id IN (?)', [ids]);
      }
      await q('UPDATE auth_db.users SET balance = ? WHERE user_id = ?', [bBefore, USER.id]);
      await q('UPDATE tuition_db.tuition_fees SET status = ? WHERE fee_id = ?', [feeBefore, FEE]);
    }
    await db.end();
  }

  console.log('\n===============================================================');
  console.log(`KẾT QUẢ E2E: ĐẠT ${passed}/${total} BÀI TEST (${Math.round((passed / total) * 100)}%)${skipped ? `, BỎ QUA ${skipped} (SKIP)` : ''}`);
  console.log('===============================================================');
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { console.error('Lỗi chạy test:', e); process.exit(1); });
