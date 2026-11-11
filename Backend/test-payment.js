// =========================================================================
// KIỂM THỬ TỰ ĐỘNG CHO NOTIFICATION-SERVICE (8004) VÀ PAYMENT-SERVICE (8003)
// Yêu cầu: MySQL + 4 service (8001-8004) đang chạy.   Chạy: node Backend/test-payment.js
// Script đọc/ghi trực tiếp DB để: lấy OTP (đáng lẽ chỉ có trong email), ép OTP hết hạn,
// ép số dư = 0 (kích hoạt Saga) và khôi phục dữ liệu mẫu sau khi test.
// Đặt KEEP_TEST_DATA=1 để giữ lại các giao dịch test trong bảng transactions.
// =========================================================================
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
// Backend/ không có node_modules riêng -> mượn mysql2 từ payment-service
const mysql = (await import(pathToFileURL(path.join(here, 'payment-service/node_modules/mysql2/promise.js')).href)).default;

const AUTH = 'http://localhost:8001', PAY = 'http://localhost:8003/api/payment', NOTI = 'http://localhost:8004';
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'ibanking_db', decimalNumbers: true
});

let passed = 0, total = 0;
const assert = (cond, name) => { total++; if (cond) { passed++; console.log(`  [PASS] ${name}`); } else console.error(`  [FAIL] ${name}`); };
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const get = async (url) => { const r = await fetch(url); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const q = async (sql, p = []) => (await db.query(sql, p))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const balance = async (u) => (await q('SELECT balance FROM users WHERE user_id = ?', [u]))[0].balance;
const feeStatus = async (f) => (await q('SELECT status FROM tuition_fees WHERE fee_id = ?', [f]))[0].status;
const txnRow = async (t) => (await q('SELECT * FROM transactions WHERE transaction_id = ?', [t]))[0];
const pendingOtp = async (t) => (await q("SELECT otp_code FROM otps WHERE transaction_id = ? AND status = 'PENDING' ORDER BY created_at DESC, otp_id DESC LIMIT 1", [t]))[0]?.otp_code;
const otpStatuses = async (t) => (await q('SELECT status FROM otps WHERE transaction_id = ? ORDER BY created_at, otp_id', [t])).map((r) => r.status);
const expireOtp = (t) => q("UPDATE otps SET expired_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE transaction_id = ? AND status = 'PENDING'", [t]);
const setFee = (f, s) => q('UPDATE tuition_fees SET status = ? WHERE fee_id = ?', [s, f]);
const wrongCode = (c) => (c === '000000' ? '111111' : '000000');

// Giao dịch giả để test riêng Notification (otps có FOREIGN KEY tới transactions)
const createdTxns = [];
let seq = 0;
async function rawTxn(status = 'PENDING_OTP') {
  const id = `TXN-TEST-${Date.now()}-${++seq}`;
  await q('INSERT INTO transactions (transaction_id, user_id, fee_id, student_id, amount, status) VALUES (?, ?, ?, ?, ?, ?)', [id, 'ACC001', 'FEE-2024-TV-0088', '524H0024', 600000, status]);
  createdTxns.push(id);
  return id;
}
// Khởi tạo thanh toán thật qua Payment Service
async function initiate(user, fee, student, amount) {
  const r = await post(`${PAY}/initiate`, { user_id: user, fee_id: fee, student_id: student, amount });
  if (r.data.transaction_id) createdTxns.push(r.data.transaction_id);
  return r;
}

async function main() {
  console.log('===============================================================');
  console.log('KIỂM THỬ NOTIFICATION-SERVICE (8004) & PAYMENT-SERVICE (8003)');
  console.log('===============================================================');

  // Snapshot để khôi phục dữ liệu mẫu sau test
  const usersBefore = await q('SELECT user_id, balance FROM users');
  const feesBefore = await q('SELECT fee_id, status FROM tuition_fees');
  const FEES = ['FEE-2024-HK1-0092', 'FEE-2024-TV-0088', 'FEE-2024-LAB-0012', 'FEE-2024-HK1-0104'];
  for (const f of FEES) await setFee(f, 'Chưa thanh toán');
  await q("UPDATE users SET balance = 15000000 WHERE user_id = 'ACC001'");
  await q("UPDATE users SET balance = 3500000 WHERE user_id = 'ACC002'");
  await q("UPDATE users SET balance = 50000000 WHERE user_id = 'ACC003'");

  try {
    // ---------------------------------------------------------------- NOTIFICATION
    console.log('\n--- NOTIFICATION-SERVICE ---');
    let t = await rawTxn();
    let r = await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'a@test.com', amount: 600000 });
    const otp1 = await pendingOtp(t);
    assert(r.status === 200 && r.data.success && r.data.data.expires_in === 300, 'N1. /send-otp trả 200, expires_in = 300');
    assert(/^\d{6}$/.test(otp1 || ''), 'N2. OTP lưu trong DB gồm đúng 6 chữ số, status PENDING');
    const secs = (await q('SELECT TIMESTAMPDIFF(SECOND, NOW(), expired_at) AS s FROM otps WHERE transaction_id = ?', [t]))[0].s;
    assert(secs >= 295 && secs <= 300, `N3. OTP hết hạn sau 5 phút (còn ${secs}s)`);
    assert((await post(`${NOTI}/send-otp`, { transaction_id: t, email: 'bad', amount: 1 })).status === 400, 'N4. /send-otp sai email -> 400');
    assert((await post(`${NOTI}/send-otp`, { transaction_id: t })).status === 400, 'N5. /send-otp thiếu trường -> 400');
    assert((await post(`${NOTI}/send-otp`, { transaction_id: 'TXN-NOPE', email: 'a@test.com', amount: 1 })).status === 404, 'N6. /send-otp giao dịch không tồn tại -> 404');
    const done = await rawTxn('COMPLETED');
    assert((await post(`${NOTI}/send-otp`, { transaction_id: done, email: 'a@test.com', amount: 1 })).status === 409, 'N7. /send-otp cho giao dịch đã COMPLETED -> 409');

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
    assert((await post(`${PAY}/initiate`, { user_id: 'NOPE', fee_id: FEES[0], student_id: '524H0024', amount: 12200000 })).status === 404, 'P3. initiate user không tồn tại -> 404');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC003', fee_id: 'FEE-NOPE', student_id: '524H0024', amount: 100 })).status === 404, 'P4. initiate fee không tồn tại -> 404');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC003', fee_id: FEES[0], student_id: '524H0129', amount: 12200000 })).status === 400, 'P5. initiate fee không thuộc sinh viên -> 400');
    assert((await post(`${PAY}/initiate`, { user_id: 'ACC003', fee_id: FEES[0], student_id: '524H0024', amount: 1000 })).status === 400, 'P6. initiate sai số tiền -> 400');

    // Số dư không đủ: chặn TRƯỚC khi tạo giao dịch/OTP
    const cntBefore = (await q("SELECT COUNT(*) AS c FROM transactions WHERE user_id = 'ACC002'"))[0].c;
    r = await initiate('ACC002', 'FEE-2024-HK1-0104', '524H0041', 5400000);
    const cntAfter = (await q("SELECT COUNT(*) AS c FROM transactions WHERE user_id = 'ACC002'"))[0].c;
    assert(r.status === 400 && r.data.code === 'INSUFFICIENT_BALANCE', 'P7. Số dư không đủ -> 400 INSUFFICIENT_BALANCE');
    assert(cntBefore === cntAfter, 'P8. Số dư không đủ: KHÔNG tạo giao dịch / OTP');

    // THÀNH CÔNG
    const b0 = await balance('ACC001');
    r = await initiate('ACC001', FEES[0], '524H0024', 12200000);
    const okTxn = r.data.transaction_id;
    assert(r.status === 200 && /^TXN-\d+-[0-9A-F]+$/.test(okTxn || '') && r.data.email === 'nguyenvana.banking@gmail.com', 'P9. initiate thành công, mã TXN-[timestamp]-[random], trả email');
    assert((await txnRow(okTxn)).status === 'PENDING_OTP' && /^\d{6}$/.test(await pendingOtp(okTxn)), 'P10. Giao dịch ở PENDING_OTP và đã có OTP');
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: okTxn, otp_code: await pendingOtp(okTxn) });
    let row = await txnRow(okTxn);
    assert(r.status === 200 && r.data.success && r.data.data.status === 'COMPLETED', 'P11. verify-and-pay thành công -> 200 COMPLETED');
    assert(row.status === 'COMPLETED' && row.completed_at, 'P12. DB: transaction COMPLETED + completed_at');
    assert((await feeStatus(FEES[0])) === 'Đã thanh toán', 'P13. Học phí được gạch nợ');
    assert((await balance('ACC001')) === b0 - 12200000, 'P14. Số dư bị trừ đúng 1 lần');
    assert(r.data.data.payerName && r.data.data.studentName === 'Nguyễn Phong Phú' && r.data.data.newBalance === b0 - 12200000, 'P15. Response đủ thông tin cho biên lai');
    assert((await otpStatuses(okTxn)).join() === 'VERIFIED', 'P16. OTP ở trạng thái VERIFIED');
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: okTxn, otp_code: '123456' });
    assert(r.status === 409 && (await balance('ACC001')) === b0 - 12200000, 'P17. verify-and-pay lại giao dịch COMPLETED -> 409, không trừ tiền lần 2');

    // Học phí đã thanh toán -> không gửi OTP
    const cnt3 = (await q('SELECT COUNT(*) AS c FROM otps')) [0].c;
    r = await initiate('ACC003', FEES[0], '524H0024', 12200000);
    assert(r.status === 409 && r.data.code === 'ALREADY_PAID' && !r.data.transaction_id, 'P18. Học phí đã đóng -> 409 ALREADY_PAID, không tạo giao dịch');
    assert((await q('SELECT COUNT(*) AS c FROM otps'))[0].c === cnt3, 'P19. Học phí đã đóng: không sinh OTP');

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

    // CASE B: 2 verify-and-pay đồng thời trên CÙNG 1 giao dịch
    await setFee(FEES[2], 'Chưa thanh toán');
    const b3 = await balance('ACC003');
    r = await initiate('ACC003', FEES[2], '524H0129', 1200000);
    tx = r.data.transaction_id;
    const dupOtp = await pendingOtp(tx);
    const dup = await Promise.all([1, 2, 3].map(() => post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: dupOtp })));
    assert(dup.filter((x) => x.status === 200).length === 1 && dup.filter((x) => x.status === 409).length === 2, 'P35. 3 verify-and-pay đồng thời cùng giao dịch: 1 thành công, 2 bị 409');
    assert((await balance('ACC003')) === b3 - 1200000, 'P36. Chống double-spending: chỉ trừ tiền đúng 1 lần');

    // CASE A: 2 người cùng đóng 1 khoản học phí
    await setFee(FEES[1], 'Chưa thanh toán');
    const bA = await balance('ACC001'), bC = await balance('ACC003');
    const a = await initiate('ACC001', FEES[1], '524H0024', 600000);
    const c = await initiate('ACC003', FEES[1], '524H0024', 600000);
    assert(a.status === 200 && c.status === 200, 'P37. Cả 2 người cùng khởi tạo được giao dịch cho 1 khoản phí');
    const [ra, rc] = await Promise.all([
      post(`${PAY}/verify-and-pay`, { transaction_id: a.data.transaction_id, otp_code: await pendingOtp(a.data.transaction_id) }),
      post(`${PAY}/verify-and-pay`, { transaction_id: c.data.transaction_id, otp_code: await pendingOtp(c.data.transaction_id) })
    ]);
    const winners = [ra, rc].filter((x) => x.status === 200), losers = [ra, rc].filter((x) => x.status === 409);
    assert(winners.length === 1 && losers.length === 1, 'P38. Double payment: đúng 1 người thành công, người kia nhận 409');
    const loserTxn = ra.status === 409 ? a.data.transaction_id : c.data.transaction_id;
    const loserUser = ra.status === 409 ? 'ACC001' : 'ACC003';
    const loserBefore = ra.status === 409 ? bA : bC;
    const lrow = await txnRow(loserTxn);
    assert(lrow.status === 'FAILED' && lrow.failure_reason === 'Học phí đã được người khác thanh toán trước đó', 'P39. Giao dịch thua: FAILED + lý do "Học phí đã được người khác thanh toán trước đó"');
    assert((await balance(loserUser)) === loserBefore, 'P40. Người thua KHÔNG bị trừ tiền');
    assert((await feeStatus(FEES[1])) === 'Đã thanh toán', 'P41. Học phí vẫn ở trạng thái đã thanh toán (do người thắng)');

    // CASE C: SAGA — học phí đã gạch nợ nhưng trừ tiền thất bại -> bù hoàn
    await setFee('FEE-2024-LAB-0012', 'Chưa thanh toán'); // LAB đã bị đóng ở CASE B -> reset trước khi Saga
    r = await initiate('ACC002', 'FEE-2024-LAB-0012', '524H0129', 1200000); // 1.2M <= 3.5M nên initiate qua được
    tx = r.data.transaction_id;
    assert(r.status === 200, 'P42. Saga: initiate thành công khi số dư còn đủ');
    await q("UPDATE users SET balance = 0 WHERE user_id = 'ACC002'"); // số dư biến mất giữa chừng
    r = await post(`${PAY}/verify-and-pay`, { transaction_id: tx, otp_code: await pendingOtp(tx) });
    row = await txnRow(tx);
    assert(r.status === 400 && r.data.code === 'INSUFFICIENT_BALANCE', 'P43. Saga: trừ tiền thất bại -> 400 INSUFFICIENT_BALANCE');
    assert((await feeStatus('FEE-2024-LAB-0012')) === 'Chưa thanh toán', 'P44. SAGA COMPENSATION: học phí đã được hoàn tác về "Chưa thanh toán"');
    assert(row.status === 'FAILED' && row.failure_reason === 'Số dư không đủ' && !row.completed_at, 'P45. Giao dịch FAILED, lý do "Số dư không đủ", không có completed_at');
    assert((await balance('ACC002')) === 0, 'P46. Không có khoản trừ tiền nào được ghi nhận');

    // Lịch sử
    r = await get(`${PAY}/history/ACC001`);
    const h = (r.data.data || []).find((x) => x.transactionId === okTxn);
    assert(r.status === 200 && Array.isArray(r.data.data) && !!h, 'P47. history/ACC001 -> 200, chứa giao dịch đã thanh toán');
    assert(h && h.status === 'COMPLETED' && h.studentName === 'Nguyễn Phong Phú' && h.amount === 12200000 && h.typeOfFee && h.createdAt && h.completedAt, 'P48. history: trường camelCase đầy đủ (student, fee, amount, status, thời gian)');
    assert((r.data.data || []).some((x) => x.status === 'FAILED' && x.failureReason), 'P49. history: giao dịch FAILED có failureReason');
    assert(!JSON.stringify(r.data).includes('password'), 'P50. history không lộ thông tin nhạy cảm');
    assert((await get(`${PAY}/history/NOPE`)).status === 404, 'P51. history user không tồn tại -> 404');

    // Auth / Tuition vẫn hoạt động
    r = await post(`${AUTH}/login`, { username: 'nguyenvana', password: 'password123' });
    assert(r.status === 200 && r.data.success, 'P52. auth-service vẫn đăng nhập bình thường');
    assert((await get('http://localhost:8002/lookup/524H0024')).status === 200, 'P53. tuition-service vẫn tra cứu bình thường');
  } finally {
    // Khôi phục dữ liệu mẫu
    for (const u of usersBefore) await q('UPDATE users SET balance = ? WHERE user_id = ?', [u.balance, u.user_id]);
    for (const f of feesBefore) await q('UPDATE tuition_fees SET status = ? WHERE fee_id = ?', [f.status, f.fee_id]);
    if (!process.env.KEEP_TEST_DATA) for (const id of createdTxns) await q('DELETE FROM transactions WHERE transaction_id = ?', [id]); // otps xóa theo (ON DELETE CASCADE)
    await db.end();
  }

  console.log('\n===============================================================');
  console.log(`KẾT QUẢ: ĐẠT ${passed}/${total} BÀI TEST (${Math.round((passed / total) * 100)}%)`);
  console.log('===============================================================');
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { console.error('Lỗi chạy test:', e); process.exit(1); });
