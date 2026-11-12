// =========================================================================
// KIỂM THỬ TỰ ĐỘNG CHO NOTIFICATION-SERVICE (8004) VÀ PAYMENT-SERVICE (8003)
// Yêu cầu: Docker stack đang chạy (docker compose up -d --build) hoặc MySQL + 4 service (8001-8004).
// Chạy: cd Backend && npm install && npm run test:payment   (mặc định kết nối MySQL Docker ở cổng 3307)
// Script dùng MỘT pool root và ghi rõ tên DB trước tên bảng (auth_db.users, tuition_db.tuition_fees,
// payment_db.transactions, notification_db.otps) để: lấy OTP (đáng lẽ chỉ có trong email), ép OTP hết hạn,
// ép số dư = 0 (kích hoạt Saga) và khôi phục dữ liệu mẫu sau khi test.
// Đặt KEEP_TEST_DATA=1 để giữ lại các giao dịch test trong bảng transactions.
// =========================================================================
import mysql from 'mysql2/promise';
import { preflight } from './test-preflight.js';

const AUTH = 'http://localhost:8001', PAY = 'http://localhost:8003/api/payment', NOTI = 'http://localhost:8004';
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3307'),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'password',
  decimalNumbers: true
});

let passed = 0, total = 0;
const assert = (cond, name) => { total++; if (cond) { passed++; console.log(`  [PASS] ${name}`); } else console.error(`  [FAIL] ${name}`); };
// --- Xác thực (Đợt 2) ---------------------------------------------------------------------------
// - Gọi /api/... : tự đăng nhập (và cache token) rồi gắn Authorization: Bearer <token> của user phù hợp.
//   Người gọi được chọn theo thứ tự: tham số asUser > chủ giao dịch (owner[transaction_id]) > body.user_id > ACC001.
// - Gọi service nội bộ (/internal/*, Notification): gắn x-internal-secret.
const INTERNAL = process.env.INTERNAL_API_SECRET || 'soa_internal_secret';
const USERNAME = { ACC000: 'admin', ACC001: 'nguyenvana', ACC002: 'tranthib', ACC003: 'lehoangc' };
const tokens = {}, owner = {};
async function tokenOf(userId) {
  if (!tokens[userId]) {
    const r = await fetch(`${AUTH}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USERNAME[userId], password: 'password123' }) });
    tokens[userId] = (await r.json()).data.token;
  }
  return tokens[userId];
}
async function headersFor(url, body, asUser) {
  const h = { 'Content-Type': 'application/json' };
  if (url.startsWith(NOTI) || url.includes('/internal/')) h['x-internal-secret'] = INTERNAL;
  else if (url.includes('/api/') ) {
    const u = asUser || owner[body?.transaction_id] || (USERNAME[body?.user_id] ? body.user_id : null) || 'ACC001';
    h.Authorization = `Bearer ${await tokenOf(u)}`;
  }
  return h;
}
const post = async (url, body, asUser) => {
  const r = await fetch(url, { method: 'POST', headers: await headersFor(url, body, asUser), body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const get = async (url, asUser) => { const r = await fetch(url, { headers: await headersFor(url, null, asUser) }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
// Request thô, KHÔNG tự gắn header: dùng cho test thiếu/giả token
const raw = async (url, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const q = async (sql, p = []) => (await db.query(sql, p))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const balance = async (u) => (await q('SELECT balance FROM auth_db.users WHERE user_id = ?', [u]))[0].balance;
const feeStatus = async (f) => (await q('SELECT status FROM tuition_db.tuition_fees WHERE fee_id = ?', [f]))[0].status;
const txnRow = async (t) => (await q('SELECT * FROM payment_db.transactions WHERE transaction_id = ?', [t]))[0];
const pendingOtp = async (t) => (await q("SELECT otp_code FROM notification_db.otps WHERE transaction_id = ? AND status = 'PENDING' ORDER BY created_at DESC, otp_id DESC LIMIT 1", [t]))[0]?.otp_code;
const otpStatuses = async (t) => (await q('SELECT status FROM notification_db.otps WHERE transaction_id = ? ORDER BY created_at, otp_id', [t])).map((r) => r.status);
const expireOtp = (t) => q("UPDATE notification_db.otps SET expired_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE transaction_id = ? AND status = 'PENDING'", [t]);
const setFee = (f, s) => q('UPDATE tuition_db.tuition_fees SET status = ? WHERE fee_id = ?', [s, f]);
const wrongCode = (c) => (c === '000000' ? '111111' : '000000');

// --- Mailpit (Đợt 3) -------------------------------------------------------------------------------
// Kiểm tra email THẬT sự được gửi. Không kết nối được Mailpit, hoặc hệ thống đang gửi Gmail thật
// (mailMode != smtp / có MAIL_TO_OVERRIDE) thì ghi SKIP, KHÔNG tính là FAIL.
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';
let skipped = 0;
const skip = (name, why) => { skipped++; console.log(`  [SKIP] ${name} (${why})`); };
async function mailpitUsable() {
  try {
    const h = (await get('http://localhost:8004/health')).data;
    if (h.mailMode !== 'smtp') return 'notification đang ở chế độ simulator (không gửi qua SMTP)';
    if (h.mailOverride) return 'đang dùng MAIL_TO_OVERRIDE (mail đi tới hộp thư thật, không qua Mailpit)';
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=1`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? null : `Mailpit trả HTTP ${r.status}`;
  } catch { return `không kết nối được Mailpit tại ${MAILPIT}`; }
}
// Tìm mail (mới nhất trước) thỏa điều kiện; thử lại tối đa ~5s vì mail biên lai được gửi bất đồng bộ
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
const mailTo = (m, addr) => (m.To || []).some((t) => (t.Address || '').toLowerCase() === addr.toLowerCase());


// Mã giao dịch giả để test riêng Notification. Sau mục 14 notification chỉ thao tác bảng otps
// (không còn khóa ngoại / kiểm tra transactions) nên chỉ cần sinh transaction_id, không chèn vào payment_db.
const createdTxns = [];
let seq = 0;
async function rawTxn() {
  const id = `TXN-TEST-${Date.now()}-${++seq}`;
  createdTxns.push(id);
  return id;
}
// Khởi tạo thanh toán thật qua Payment Service
async function initiate(user, fee, student, amount) {
  // Giống frontend: KHÔNG gửi user_id, người dùng lấy từ JWT
  const r = await post(`${PAY}/initiate`, { fee_id: fee, student_id: student, amount }, user);
  if (r.data.transaction_id) { createdTxns.push(r.data.transaction_id); owner[r.data.transaction_id] = user; }
  return r;
}

async function main() {
  await preflight({ db });
  console.log('===============================================================');
  console.log('KIỂM THỬ NOTIFICATION-SERVICE (8004) & PAYMENT-SERVICE (8003)');
  console.log('===============================================================');

  // Snapshot để khôi phục dữ liệu mẫu sau test
  const usersBefore = await q('SELECT user_id, balance FROM auth_db.users');
  const feesBefore = await q('SELECT fee_id, status FROM tuition_db.tuition_fees');
  const FEES = ['FEE-2024-HK1-0092', 'FEE-2024-TV-0088', 'FEE-2024-LAB-0012', 'FEE-2024-HK1-0104'];
  for (const f of FEES) await setFee(f, 'Chưa thanh toán');
  await q("UPDATE auth_db.users SET balance = 15000000 WHERE user_id = 'ACC001'");
  await q("UPDATE auth_db.users SET balance = 3500000 WHERE user_id = 'ACC002'");
  await q("UPDATE auth_db.users SET balance = 50000000 WHERE user_id = 'ACC003'");

  try {
    // ---------------------------------------------------------------- NOTIFICATION
    console.log('\n--- NOTIFICATION-SERVICE ---');
    let t = await rawTxn();
    let r = await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const otp1 = await pendingOtp(t);
    assert(r.status === 200 && r.data.success && r.data.data.expires_in === 300, 'N1. /send-otp trả 200, expires_in = 300');
    assert(/^\d{6}$/.test(otp1 || ''), 'N2. OTP lưu trong DB gồm đúng 6 chữ số, status PENDING');
    const secs = (await q('SELECT TIMESTAMPDIFF(SECOND, NOW(), expired_at) AS s FROM notification_db.otps WHERE transaction_id = ?', [t]))[0].s;
    assert(secs >= 295 && secs <= 300, `N3. OTP hết hạn sau 5 phút (còn ${secs}s)`);
    assert((await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'bad', amount: 1 })).status === 400, 'N4. /send-otp sai email -> 400');
    assert((await post(`${NOTI}/send-otp`, { transaction_id: t })).status === 400, 'N5. /send-otp thiếu trường -> 400');
    // Hành vi mới (mục 14.6): notification không còn kiểm tra bảng transactions (thuộc payment_db);
    // payment-service chịu trách nhiệm kiểm tra trạng thái giao dịch trước khi gọi /send-otp.
    const lone = await rawTxn();
    assert((await post(`${NOTI}/send-otp`, { transaction_id: lone, email: 'a@test.com', amount: 1 })).status === 200, 'N6. /send-otp không còn tra cứu transactions -> 200 (không còn 404)');
    assert((await otpStatuses(lone)).join() === 'PENDING', 'N7. /send-otp chỉ ghi bảng otps của notification_db (không còn 409)');

    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: wrongCode(otp1) });
    assert(r.status === 400 && r.data.code === 'OTP_MISMATCH', 'N8. OTP sai -> 400 OTP_MISMATCH');
    assert((await otpStatuses(t)).join() === 'PENDING', 'N9. OTP sai không làm đổi trạng thái (vẫn PENDING)');
    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: otp1 });
    assert(r.status === 200 && r.data.success, 'N10. OTP đúng -> 200');
    assert((await otpStatuses(t)).join() === 'VERIFIED', 'N11. OTP chuyển sang VERIFIED');
    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: otp1 });
    assert(r.status === 400 && r.data.code === 'OTP_ALREADY_USED', 'N12. Dùng lại OTP đã VERIFIED -> 400 (single-use)');
    assert((await post(`${NOTI}/verify-otp`, { transaction_id: 'TXN-NO-OTP', otp_code: '123456' })).status === 404, 'N13. Giao dịch chưa có OTP -> 404');
    assert((await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: '12' })).status === 400, 'N14. otp_code không đủ 6 số -> 400');

    // Gửi lại OTP -> OTP cũ mất hiệu lực
    t = await rawTxn();
    await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const oldOtp = await pendingOtp(t);
    await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const newOtp = await pendingOtp(t);
    assert((await otpStatuses(t)).join() === 'EXPIRED,PENDING', 'N15. Gửi lại: OTP cũ -> EXPIRED, chỉ còn 1 OTP PENDING');
    if (oldOtp !== newOtp) {
      r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: oldOtp });
      assert(r.status === 400, 'N16. OTP cũ không còn dùng được');
    } else assert(true, 'N16. (OTP mới trùng OTP cũ do ngẫu nhiên, bỏ qua)');
    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: newOtp });
    assert(r.status === 200, 'N17. OTP mới xác thực thành công');
    // Mục 14.6: verify thành công thì các OTP PENDING còn lại của cùng giao dịch bị vô hiệu hóa
    t = await rawTxn();
    await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const keep = await pendingOtp(t);
    await q("INSERT INTO notification_db.otps (otp_id, transaction_id, otp_code, status, expired_at) VALUES (?, ?, '999999', 'PENDING', DATE_ADD(NOW(), INTERVAL 5 MINUTE))", [`OTP-TEST-${Date.now()}`, t]);
    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: '999999' });
    assert(r.status === 200 && !(await otpStatuses(t)).includes('PENDING'), 'N17b. Verify thành công -> mọi OTP PENDING còn lại chuyển EXPIRED');

    // Hết hạn
    t = await rawTxn();
    await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const exOtp = await pendingOtp(t);
    await expireOtp(t);
    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: exOtp });
    assert(r.status === 400 && r.data.code === 'OTP_EXPIRED', 'N18. OTP quá hạn -> 400 OTP_EXPIRED');
    assert((await otpStatuses(t)).join() === 'EXPIRED', 'N19. OTP quá hạn được đổi status = EXPIRED');

    // /cancel-otp
    t = await rawTxn();
    await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const cOtp = await pendingOtp(t);
    r = await post(`${NOTI}/cancel-otp`, { transaction_id: t });
    assert(r.status === 200 && r.data.success, 'N20. /cancel-otp -> 200');
    r = await post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: cOtp });
    assert(r.status === 400, 'N21. OTP đã hủy không thể verify');
    assert((await post(`${NOTI}/cancel-otp`, {})).status === 400, 'N22. /cancel-otp thiếu transaction_id -> 400');

    // Race: 2 verify đồng thời cùng 1 OTP
    t = await rawTxn();
    await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const raceOtp = await pendingOtp(t);
    const rr = await Promise.all([1, 2, 3].map(() => post(`${NOTI}/verify-otp`, { transaction_id: t, otp_code: raceOtp })));
    assert(rr.filter((x) => x.status === 200).length === 1, 'N23. 3 verify đồng thời cùng OTP: đúng 1 request thành công');

    // /send-receipt
    r = await post(`${NOTI}/send-receipt`, { email: 'a@test.com', transaction_id: 'TXN-X', full_name: 'Nguyễn Văn A', student_id: '524H0024', student_name: 'Nguyễn Phong Phú', amount: 1200000 });
    assert(r.status === 200 && r.data.success, 'N24. /send-receipt -> 200 (SMTP hoặc simulator)');
    assert((await post(`${NOTI}/send-receipt`, { email: 'a@test.com' })).status === 400, 'N25. /send-receipt thiếu trường -> 400');

    // ---------------------------------------------------------------- PAYMENT
    console.log('\n--- PAYMENT-SERVICE ---');
    // Validate đầu vào
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC001' })).status === 400, 'P1. initiate thiếu trường -> 400');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC001', fee_id: FEES[0], student_id: '524H0024', amount: -5 })).status === 400, 'P2. initiate amount âm -> 400');
    r = await post(`${PAY}/initiate`, { user_id: 'NOPE', fee_id: FEES[0], student_id: '524H0024', amount: 12200000 });
    assert(r.status === 403 && r.data.code === 'FORBIDDEN', 'P3. initiate với user_id trong body khác token -> 403 FORBIDDEN (user_id lấy từ JWT)');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC003', fee_id: 'FEE-NOPE', student_id: '524H0024', amount: 100 })).status === 404, 'P4. initiate fee không tồn tại -> 404');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC003', fee_id: FEES[0], student_id: '524H0129', amount: 12200000 })).status === 400, 'P5. initiate fee không thuộc sinh viên -> 400');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC003', fee_id: FEES[0], student_id: '524H0024', amount: 1000 })).status === 400, 'P6. initiate sai số tiền -> 400');

    // Số dư không đủ: chặn TRƯỚC khi tạo giao dịch/OTP
    const cntBefore = (await q("SELECT COUNT(*) AS c FROM payment_db.transactions WHERE user_id = 'ACC002'"))[0].c;
    r = await initiate('ACC002', 'FEE-2024-HK1-0104', '524H0041', 5400000);
    const cntAfter = (await q("SELECT COUNT(*) AS c FROM payment_db.transactions WHERE user_id = 'ACC002'"))[0].c;
    assert(r.status === 400 && r.data.code === 'INSUFFICIENT_BALANCE', 'P7. Số dư không đủ -> 400 INSUFFICIENT_BALANCE');
    assert(cntBefore === cntAfter, 'P8. Số dư không đủ: KHÔNG tạo giao dịch / OTP');

    // THÀNH CÔNG
    const b0 = await balance('ACC001');
    r = await initiate('ACC001', FEES[0], '524H0024', 12200000);
    const okTxn = r.data.transaction_id;
    assert(r.status === 200 && /^TXN-\d+-[0-9A-F]+$/.test(okTxn || '') && r.data.email === 'nguyenvana.banking@gmail.com', 'P9. initiate thành công, mã TXN-[timestamp]-[random], trả email');
    assert((await txnRow(okTxn)).status === 'PENDING_OTP' && /^\d{6}$/.test(await pendingOtp(okTxn)), 'P10. Giao dịch ở PENDING_OTP và đã có OTP');
    // Email OTP thật sự được gửi: mã trong mail KHỚP mã OTP trong DB
    const mailWhy = await mailpitUsable();
    const okOtp = await pendingOtp(okTxn);
    if (mailWhy) skip('M1. Mailpit nhận mail OTP', mailWhy);
    else {
      const otpMail = await findMail((m) => mailTo(m, 'nguyenvana.banking@gmail.com') && /OTP/.test(m.Subject || '') && (m.Text || m.HTML || '').includes(okOtp));
      assert(!!otpMail, 'M1. Mailpit nhận mail OTP gửi tới email người dùng, mã OTP trong mail khớp OTP trong DB');
    }
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: okTxn, otp_code: okOtp });
    let row = await txnRow(okTxn);
    assert(r.status === 200 && r.data.success && r.data.data.status === 'COMPLETED', 'P11. verify-and-pay thành công -> 200 COMPLETED');
    assert(row.status === 'COMPLETED' && row.completed_at, 'P12. DB: transaction COMPLETED + completed_at');
    assert((await feeStatus(FEES[0])) === 'Đã thanh toán', 'P13. Học phí được gạch nợ');
    assert((await balance('ACC001')) === b0 - 12200000, 'P14. Số dư bị trừ đúng 1 lần');
    assert(r.data.data.payerName && r.data.data.studentName === 'Nguyễn Phong Phú' && r.data.data.newBalance === b0 - 12200000, 'P15. Response đủ thông tin cho biên lai');
    if (mailWhy) skip('M2. Mailpit nhận mail biên lai', mailWhy);
    else {
      const rcpt = await findMail((m) => mailTo(m, 'nguyenvana.banking@gmail.com') && (m.Subject || '').includes(okTxn));
      assert(!!rcpt, 'M2. Sau thanh toán thành công, Mailpit nhận mail biên lai (tiêu đề chứa mã giao dịch)');
    }
    assert((await otpStatuses(okTxn)).join() === 'VERIFIED', 'P16. OTP ở trạng thái VERIFIED');
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: okTxn, otp_code: '123456' });
    assert(r.status === 409 && (await balance('ACC001')) === b0 - 12200000, 'P17. verify-and-pay lại giao dịch COMPLETED -> 409, không trừ tiền lần 2');

    // Học phí đã thanh toán -> không gửi OTP
    const cnt3 = (await q('SELECT COUNT(*) AS c FROM notification_db.otps')) [0].c;
    r = await initiate('ACC003', FEES[0], '524H0024', 12200000);
    assert(r.status === 409 && r.data.code === 'ALREADY_PAID' && !r.data.transaction_id, 'P18. Học phí đã đóng -> 409 ALREADY_PAID, không tạo giao dịch');
    assert((await q('SELECT COUNT(*) AS c FROM notification_db.otps'))[0].c === cnt3, 'P19. Học phí đã đóng: không sinh OTP');

    // OTP sai -> FAILED
    await setFee(FEES[1], 'Chưa thanh toán');
    let bal = await balance('ACC001');
    r = await initiate('ACC001', FEES[1], '524H0024', 600000);
    let tx = r.data.transaction_id;
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: wrongCode(await pendingOtp(tx)) });
    row = await txnRow(tx);
    assert(r.status === 400 && r.data.code === 'OTP_MISMATCH', 'P20. OTP sai -> 400 OTP_MISMATCH');
    assert(row.status === 'FAILED' && /OTP_MISMATCH/.test(row.failure_reason || ''), 'P21. Giao dịch FAILED kèm failure_reason');
    assert((await feeStatus(FEES[1])) === 'Chưa thanh toán' && (await balance('ACC001')) === bal, 'P22. OTP sai: học phí không bị gạch, tiền không bị trừ');

    // OTP hết hạn -> FAILED
    r = await initiate('ACC001', FEES[1], '524H0024', 600000);
    tx = r.data.transaction_id;
    const exp = await pendingOtp(tx);
    await expireOtp(tx);
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: exp });
    assert(r.status === 400 && r.data.code === 'OTP_EXPIRED', 'P23. OTP hết hạn -> 400 OTP_EXPIRED (phân biệt với OTP_MISMATCH)');
    assert((await txnRow(tx)).status === 'FAILED' && (await otpStatuses(tx)).join() === 'EXPIRED', 'P24. Giao dịch FAILED, OTP EXPIRED');
    assert((await feeStatus(FEES[1])) === 'Chưa thanh toán' && (await balance('ACC001')) === bal, 'P25. OTP hết hạn: không gạch nợ, không trừ tiền');

    // Hủy giao dịch
    r = await initiate('ACC001', FEES[1], '524H0024', 600000);
    tx = r.data.transaction_id;
    const cancelOtp = await pendingOtp(tx);
    r = await post(`${PAY}/cancel`, { transaction_id: tx });
    assert(r.status === 200 && (await txnRow(tx)).status === 'CANCELLED', 'P26. cancel -> 200, giao dịch CANCELLED');
    assert((await otpStatuses(tx)).join() === 'EXPIRED', 'P27. OTP bị vô hiệu hóa sau khi hủy');
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: cancelOtp });
    assert(r.status === 409 && (await feeStatus(FEES[1])) === 'Chưa thanh toán' && (await balance('ACC001')) === bal, 'P28. Sau khi hủy, verify-and-pay bị từ chối (409), không thanh toán');
    assert((await post(`${PAY}/cancel`, { transaction_id: tx })).status === 409, 'P29. Hủy lần 2 (CANCELLED -> CANCELLED) -> 409');
    assert((await post(`${PAY}/cancel`, { transaction_id: okTxn })).status === 409 && (await txnRow(okTxn)).status === 'COMPLETED', 'P30. Không thể hủy giao dịch COMPLETED');
    assert((await post(`${PAY}/cancel`, { transaction_id: 'TXN-NOPE' })).status === 404, 'P31. Hủy giao dịch không tồn tại -> 404');
    assert((await post(`${PAY}/verify-and-pay`, { transaction_id: 'TXN-NOPE', otp_code: '123456' })).status === 404, 'P32. verify-and-pay giao dịch không tồn tại -> 404');

    // Gửi lại OTP qua Payment Service
    r = await initiate('ACC001', FEES[1], '524H0024', 600000);
    tx = r.data.transaction_id;
    const first = await pendingOtp(tx);
    r = await post(`${PAY}/resend-otp`, { transaction_id: tx });
    assert(r.status === 200 && (await otpStatuses(tx)).join() === 'EXPIRED,PENDING', 'P33. resend-otp: OTP cũ vô hiệu, có OTP mới');
    await post(`${PAY}/cancel`, { transaction_id: tx });
    assert((await post(`${PAY}/resend-otp`, { transaction_id: tx })).status === 409, 'P34. resend-otp cho giao dịch đã hủy -> 409');

    // Idempotency: nhiều verify-and-pay đồng thời trên CÙNG 1 giao dịch
    console.log('\n--- DUPLICATE REQUEST: nhiều verify-and-pay đồng thời cho cùng một giao dịch ---');
    await setFee(FEES[2], 'Chưa thanh toán');
    const b3 = await balance('ACC003');
    r = await initiate('ACC003', FEES[2], '524H0129', 1200000);
    tx = r.data.transaction_id;
    const dupOtp = await pendingOtp(tx);
    const dup = await Promise.all([1, 2, 3].map(() => post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: dupOtp })));
    assert(dup.filter((x) => x.status === 200).length === 1 && dup.filter((x) => x.status === 409).length === 2, 'P35. 3 verify-and-pay đồng thời cùng giao dịch: 1 thành công, 2 bị 409');
    assert((await balance('ACC003')) === b3 - 1200000, 'P36. Chống double-spending: chỉ trừ tiền đúng 1 lần');

    // CASE A (trong code cũ) = CONCURRENCY B của rubric
    console.log('\n--- CONCURRENCY B: nhiều tài khoản cùng thanh toán MỘT khoản học phí ---');
    await setFee(FEES[1], 'Chưa thanh toán');
    const bA = await balance('ACC001'), bC = await balance('ACC003');
    const a = await initiate('ACC001', FEES[1], '524H0024', 600000);
    const c = await initiate('ACC003', FEES[1], '524H0024', 600000);
    assert(a.status === 200 && c.status === 409 && c.data.code === 'FEE_LOCKED', 'P37. [CONCURRENCY B] Người thứ 2 bị chặn ngay ở initiate: 409 FEE_LOCKED');
    const ra = await post(`${PAY}/verify-and-pay`, { transaction_id: a.data.transaction_id, otp_code: await pendingOtp(a.data.transaction_id) });
    assert(ra.status === 200, 'P38. [CONCURRENCY B] Người đầu thanh toán thành công');
    assert((await balance('ACC003')) === bC, 'P40. [CONCURRENCY B] Người bị chặn KHÔNG bị trừ tiền');
    assert((await feeStatus(FEES[1])) === 'Đã thanh toán', 'P41. [CONCURRENCY B] Học phí ở trạng thái đã thanh toán');

    // CONCURRENCY A: một tài khoản thanh toán đồng thời nhiều khoản, số dư chỉ đủ cho 1 khoản
    console.log('\n--- CONCURRENCY A: một tài khoản thanh toán đồng thời nhiều khoản (số dư chỉ đủ 1 khoản) ---');
    await setFee('FEE-2024-LAB-0012', 'Chưa thanh toán'); await setFee('FEE-2024-TV-0088', 'Chưa thanh toán');
    await q("UPDATE auth_db.users SET balance = 1500000 WHERE user_id = 'ACC002'"); // đủ cho 1.2tr HOẶC 600k, KHÔNG đủ cả hai (1.8tr)
    const ca1 = await initiate('ACC002', 'FEE-2024-LAB-0012', '524H0129', 1200000);
    const ca2 = await initiate('ACC002', 'FEE-2024-TV-0088', '524H0024', 600000);
    assert(ca1.status === 200 && ca2.status === 200, 'CA1. [CONCURRENCY A] Cả 2 giao dịch cùng qua bước initiate (mỗi khoản riêng lẻ đều đủ tiền)');
    const [oa, ob] = await Promise.all([
      post(`${PAY}/verify-and-pay`, { transaction_id: ca1.data.transaction_id, otp_code: await pendingOtp(ca1.data.transaction_id) }),
      post(`${PAY}/verify-and-pay`, { transaction_id: ca2.data.transaction_id, otp_code: await pendingOtp(ca2.data.transaction_id) })
    ]);
    const okCount = [oa, ob].filter((x) => x.status === 200).length;
    assert(okCount === 1, `CA2. [CONCURRENCY A] Đúng 1 giao dịch thành công (thực tế: ${okCount})`);
    const winA = oa.status === 200 ? { t: ca1, fee: 'FEE-2024-LAB-0012', amt: 1200000 } : { t: ca2, fee: 'FEE-2024-TV-0088', amt: 600000 };
    const loseA = oa.status === 200 ? { t: ca2, fee: 'FEE-2024-TV-0088' } : { t: ca1, fee: 'FEE-2024-LAB-0012' };
    const balA = await balance('ACC002');
    assert(balA >= 0 && balA === 1500000 - winA.amt, `CA3. [CONCURRENCY A] Số dư KHÔNG âm và chỉ bị trừ đúng 1 khoản (còn ${balA})`);
    const loserRes = oa.status === 200 ? ob : oa;
    assert(loserRes.status === 400 && loserRes.data.code === 'INSUFFICIENT_BALANCE' && (await txnRow(loseA.t.data.transaction_id)).status === 'FAILED', 'CA4. [CONCURRENCY A] Giao dịch thua: 400 INSUFFICIENT_BALANCE, trạng thái FAILED');
    assert((await feeStatus(winA.fee)) === 'Đã thanh toán' && (await feeStatus(loseA.fee)) === 'Chưa thanh toán', 'CA5. [CONCURRENCY A] Khoản thắng được gạch nợ, khoản thua được Saga hoàn tác về "Chưa thanh toán"');
    await q("UPDATE auth_db.users SET balance = 3500000 WHERE user_id = 'ACC002'"); // khôi phục cho bước Saga bên dưới

    // CASE C: SAGA — học phí đã gạch nợ nhưng trừ tiền thất bại -> bù hoàn
    await setFee('FEE-2024-LAB-0012', 'Chưa thanh toán'); // LAB đã bị đóng ở CASE B -> reset trước khi Saga
    r = await initiate('ACC002', 'FEE-2024-LAB-0012', '524H0129', 1200000); // 1.2M <= 3.5M nên initiate qua được
    tx = r.data.transaction_id;
    assert(r.status === 200, 'P42. Saga: initiate thành công khi số dư còn đủ');
    await q("UPDATE auth_db.users SET balance = 0 WHERE user_id = 'ACC002'"); // số dư biến mất giữa chừng
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: await pendingOtp(tx) });
    row = await txnRow(tx);
    assert(r.status === 400 && r.data.code === 'INSUFFICIENT_BALANCE', 'P43. Saga: trừ tiền thất bại -> 400 INSUFFICIENT_BALANCE');
    assert((await feeStatus('FEE-2024-LAB-0012')) === 'Chưa thanh toán', 'P44. SAGA COMPENSATION: học phí đã được hoàn tác về "Chưa thanh toán"');
    assert(row.status === 'FAILED' && row.failure_reason === 'Số dư không đủ' && !row.completed_at, 'P45. Giao dịch FAILED, lý do "Số dư không đủ", không có completed_at');
    assert((await balance('ACC002')) === 0, 'P46. Không có khoản trừ tiền nào được ghi nhận');

    // Lịch sử
    r = await get(`${PAY}/history`, 'ACC001');
    const h = (r.data.data || []).find((x) => x.transactionId === okTxn);
    assert(r.status === 200 && Array.isArray(r.data.data) && !!h, 'P47. history/ACC001 -> 200, chứa giao dịch đã thanh toán');
    assert(h && h.status === 'COMPLETED' && h.studentName === 'Nguyễn Phong Phú' && h.amount === 12200000 && h.typeOfFee && h.createdAt && h.completedAt, 'P48. history: trường camelCase đầy đủ (student, fee, amount, status, thời gian)');
    assert((r.data.data || []).some((x) => x.status === 'FAILED' && x.failureReason), 'P49. history: giao dịch FAILED có failureReason');
    assert(!JSON.stringify(r.data).includes('password'), 'P50. history không lộ thông tin nhạy cảm');
    r = await get(`${PAY}/history`, 'ACC000'); // admin không có giao dịch nào
    assert(r.status === 200 && Array.isArray(r.data.data) && r.data.data.length === 0, 'P51. history của user không có giao dịch -> 200, data: [] (payment không kiểm tra users)');
    // Snapshot (mục 14.3) được ghi khi initiate
    const snap = await txnRow(okTxn);
    assert(snap.payer_name === 'Nguyễn Văn A' && snap.payer_email === 'nguyenvana.banking@gmail.com' && snap.student_name === 'Nguyễn Phong Phú' && !!snap.type_of_fee, 'P51b. transactions lưu snapshot payer/student/type_of_fee');
    // Auth/Tuition không có tên DB của service khác: user auth_user không được vào payment_db
    r = await get('http://localhost:8001/internal/users/ACC001'); // get() tự gắn x-internal-secret
    assert(r.status === 200 && r.data.data.balance > 0 && (await get('http://localhost:8001/internal/users/NOPE')).status === 404, 'P51c. GET /internal/users/:id -> 200 / 404 USER_NOT_FOUND');
    r = await get('http://localhost:8002/internal/fees/FEE-2024-TV-0088');
    assert(r.status === 200 && r.data.data.student_name === 'Nguyễn Phong Phú' && (await get('http://localhost:8002/internal/fees/NOPE')).status === 404, 'P51d. GET /internal/fees/:id -> 200 (kèm student_name) / 404 FEE_NOT_FOUND');

    // ---------------------------------------------------------------- BẢO MẬT (Đợt 2)
    console.log('\n--- BẢO MẬT: JWT & PHÂN QUYỀN GIAO DỊCH ---');
    const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IkFDQzAwMSJ9.sai-chu-ky';
    const initBody = { fee_id: FEES[1], student_id: '524H0024', amount: 600000 };
    r = await raw(`${PAY}/initiate`, { method: 'POST', body: initBody });
    assert(r.status === 401 && r.data.code === 'UNAUTHORIZED', 'S1. initiate KHÔNG token -> 401 UNAUTHORIZED');
    r = await raw(`${PAY}/initiate`, { method: 'POST', headers: { Authorization: `Bearer ${forged}` }, body: initBody });
    assert(r.status === 401, 'S2. initiate với token giả mạo -> 401');
    assert((await raw(`${PAY}/history`)).status === 401, 'S3. history KHÔNG token -> 401');
    assert((await raw(`${PAY}/verify-and-pay`, { method: 'POST', body: { transaction_id: okTxn, otp_code: '123456' } })).status === 401, 'S4. verify-and-pay KHÔNG token -> 401');
    assert((await raw(`${PAY}/cancel`, { method: 'POST', body: { transaction_id: okTxn } })).status === 401 && (await raw(`${PAY}/resend-otp`, { method: 'POST', body: { transaction_id: okTxn } })).status === 401, 'S5. cancel / resend-otp KHÔNG token -> 401');
    assert((await raw('http://localhost:8003/health')).status === 200, 'S6. /health payment vẫn công khai');

    // Giả mạo user_id: không tạo giao dịch nào
    const cntForge = (await q("SELECT COUNT(*) AS c FROM payment_db.transactions WHERE user_id = 'ACC003'"))[0].c;
    r = await post(`${PAY}/initiate`, { user_id: 'ACC003', ...initBody }, 'ACC001');
    assert(r.status === 403 && r.data.code === 'FORBIDDEN' && (await q("SELECT COUNT(*) AS c FROM payment_db.transactions WHERE user_id = 'ACC003'"))[0].c === cntForge, 'S7. Dùng token ACC001 nhưng body user_id=ACC003 -> 403, không tạo giao dịch');

    // Giao dịch của người khác: verify-and-pay / cancel / resend-otp đều 403, giao dịch không bị ảnh hưởng
    await setFee(FEES[1], 'Chưa thanh toán');
    const bOwner = await balance('ACC003'), bAtk = await balance('ACC001');
    r = await initiate('ACC003', FEES[1], '524H0024', 600000);
    const victim = r.data.transaction_id;
    const victimOtp = await pendingOtp(victim);
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: victim, otp_code: victimOtp }, 'ACC001');
    assert(r.status === 403 && r.data.code === 'FORBIDDEN', 'S8. ACC001 verify-and-pay giao dịch của ACC003 (dù biết OTP) -> 403');
    assert((await txnRow(victim)).status === 'PENDING_OTP' && (await feeStatus(FEES[1])) === 'Chưa thanh toán' && (await balance('ACC003')) === bOwner && (await balance('ACC001')) === bAtk, 'S9. Bị từ chối: giao dịch vẫn PENDING_OTP, học phí chưa gạch, không ai bị trừ tiền');
    assert((await post(`${PAY}/cancel`, { transaction_id: victim }, 'ACC001')).status === 403 && (await txnRow(victim)).status === 'PENDING_OTP', 'S10. ACC001 hủy giao dịch của ACC003 -> 403, giao dịch không đổi');
    assert((await post(`${PAY}/resend-otp`, { transaction_id: victim }, 'ACC001')).status === 403 && (await otpStatuses(victim)).join() === 'PENDING', 'S11. ACC001 gửi lại OTP cho giao dịch của ACC003 -> 403, không sinh OTP mới');
    r = await get(`${PAY}/history`, 'ACC001');
    assert(!(r.data.data || []).some((x) => x.transactionId === victim), 'S12. history của ACC001 không chứa giao dịch của ACC003 (cô lập theo token)');
    assert((await post(`${PAY}/cancel`, { transaction_id: victim })).status === 200, 'S13. Chủ giao dịch (ACC003) vẫn hủy được bình thường');

    // URI cũ đã gỡ
    assert((await raw(`${PAY}/history/ACC001`, { headers: { Authorization: `Bearer ${await tokenOf('ACC001')}` } })).status === 404, 'S14. URI cũ GET /api/payment/history/:user_id đã gỡ -> 404');
    assert((await raw('http://localhost:8003/initiate', { method: 'POST', headers: { Authorization: `Bearer ${await tokenOf('ACC001')}` }, body: initBody })).status === 404, 'S15. Alias cũ POST /initiate đã gỡ -> 404');

    // ---------------------------------------------------------------- SCHEMA & DỮ LIỆU (Đợt 3)
    console.log('\n--- SCHEMA & TOÀN VẸN DỮ LIỆU ---');
    const violates = async (sql, p = []) => { try { await q(sql, p); return false; } catch (e) { return e.errno === 3819 || /check constraint/i.test(e.message); } };
    const bNeg = await balance('ACC003');
    assert(await violates("UPDATE auth_db.users SET balance = -1 WHERE user_id = 'ACC003'") && (await balance('ACC003')) === bNeg, 'D1. CHECK: không thể làm users.balance âm bằng SQL trực tiếp');
    assert(await violates("UPDATE tuition_db.tuition_fees SET price = 0 WHERE fee_id = 'FEE-2024-TV-0088'"), 'D2. CHECK: tuition_fees.price phải > 0');
    assert(await violates("INSERT INTO payment_db.transactions (transaction_id, user_id, fee_id, student_id, amount, payer_name, payer_email, student_name, type_of_fee) VALUES ('TXN-D3', 'ACC001', 'F', 'S', 0, 'a', 'a@a.a', 's', 't')"), 'D3. CHECK: transactions.amount phải > 0');
    const idx = (await q("SELECT DISTINCT index_name AS n FROM information_schema.statistics WHERE table_schema = 'payment_db' AND table_name = 'transactions'")).map((x) => x.n);
    assert(['idx_txn_user_created', 'idx_txn_fee', 'idx_txn_status'].every((n) => idx.includes(n)), 'D4. transactions có index (user_id, created_at), (fee_id), (status)');
    assert((await q("SELECT faculty FROM tuition_db.students WHERE student_id = '524H0041'"))[0].faculty === 'Ngoại ngữ Thương mại', 'D5. Dữ liệu mẫu: đã sửa lỗi gõ "Thương mạ   i"');
    // deduct tính bằng SQL (DECIMAL): new_balance chính xác tới xu và khớp DB
    const bDec = await balance('ACC003');
    r = await post('http://localhost:8001/internal/deduct', { user_id: 'ACC003', amount: 1000000.1, transaction_id: 'TXN-D6' });
    const bAfterDec = await balance('ACC003');
    assert(r.status === 200 && Math.round(r.data.data.new_balance * 100) === Math.round(bAfterDec * 100) && Math.round(bAfterDec * 100) === Math.round(bDec * 100) - 100000010, 'D6. deduct dùng SQL (balance = balance - ?): new_balance chính xác 2 chữ số thập phân, khớp DB');
    await q("UPDATE auth_db.users SET balance = ? WHERE user_id = 'ACC003'", [bDec]);
    assert((await post('http://localhost:8001/internal/deduct', { user_id: 'ACC003', amount: 0, transaction_id: 'T' })).status === 400 && (await post('http://localhost:8001/internal/deduct', { user_id: 'ACC003', amount: -5, transaction_id: 'T' })).status === 400, 'D7. deduct amount 0 hoặc âm -> 400 (không thể "trừ tiền âm" để cộng tiền)');
    assert((await balance('ACC003')) === bDec, 'D8. Số dư không đổi sau các lần deduct bị từ chối');

    // Auth / Tuition vẫn hoạt động
    r = await post(`${AUTH}/api/auth/login`, { username: 'nguyenvana', password: 'password123' });
    assert(r.status === 200 && r.data.success, 'P52. auth-service vẫn đăng nhập bình thường');
    assert((await get('http://localhost:8002/api/tuition/students/524H0024')).status === 200, 'P53. tuition-service vẫn tra cứu bình thường (có JWT)');
  } finally {
    // Khôi phục dữ liệu mẫu
    for (const u of usersBefore) await q('UPDATE auth_db.users SET balance = ? WHERE user_id = ?', [u.balance, u.user_id]);
    for (const f of feesBefore) await q('UPDATE tuition_db.tuition_fees SET status = ? WHERE fee_id = ?', [f.status, f.fee_id]);
    // Không còn ON DELETE CASCADE (không có FK chéo database) -> xóa otps thủ công theo transaction_id
    if (!process.env.KEEP_TEST_DATA) for (const id of createdTxns) {
      await q('DELETE FROM notification_db.otps WHERE transaction_id = ?', [id]);
      await q('DELETE FROM payment_db.transactions WHERE transaction_id = ?', [id]);
    }
    await db.end();
  }

  console.log('\n===============================================================');
  console.log(`KẾT QUẢ: ĐẠT ${passed}/${total} BÀI TEST (${Math.round((passed / total) * 100)}%)${skipped ? `, BỎ QUA ${skipped} (SKIP)` : ''}`);
  console.log('===============================================================');
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { console.error('Lỗi chạy test:', e); process.exit(1); });
