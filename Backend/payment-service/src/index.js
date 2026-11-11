// Nhiệm vụ: ORCHESTRATOR điều phối thanh toán — FSM, chống tranh chấp đồng thời, Saga bù hoàn
//
// FSM giao dịch:  PENDING_OTP -> PROCESSING -> COMPLETED
//                 (lỗi) -> FAILED      (người dùng hủy khi còn PENDING_OTP) -> CANCELLED
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { pool, testConnection } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8003;
const SERVICE_TIMEOUT_MS = 10000;

const urls = () => ({
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:8001',
  tuition: process.env.TUITION_SERVICE_URL || 'http://localhost:8002',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8004'
});

const STATUS_UNPAID = 'Chưa thanh toán';
const STATUS_PAID = 'Đã thanh toán';
const REASON_ALREADY_PAID = 'Học phí đã được người khác thanh toán trước đó';

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[Payment Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next();
});

const log = (txn, msg) => console.log(`[Payment Service] [${txn}] ${msg}`);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gọi microservice khác. KHÔNG BAO GIỜ ném lỗi — luôn trả về
 * { ok, status, data, networkError } để orchestrator tự quyết định xử lý.
 */
async function callService(name, baseUrl, path, body) {
  try {
    const r = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS)
    });
    let data = null;
    try { data = await r.json(); } catch { /* body không phải JSON */ }
    if (!r.ok) console.error(`[Payment Service] ${name} ${path} -> HTTP ${r.status}`, data);
    return { ok: r.ok, status: r.status, data, networkError: null };
  } catch (err) {
    console.error(`[Payment Service] Không gọi được ${name} ${path}: ${err.message}`);
    return { ok: false, status: 0, data: null, networkError: err.message };
  }
}

// Chuyển trạng thái FSM bằng UPDATE có điều kiện (DB là nguồn sự thật)
async function transition(txnId, from, to, { reason = null, completed = false } = {}) {
  const [r] = await pool.query(
    `UPDATE transactions SET status = ?, failure_reason = ?${completed ? ', completed_at = NOW()' : ''} WHERE transaction_id = ? AND status = ?`,
    [to, reason ? reason.slice(0, 255) : null, txnId, from]
  );
  if (r.affectedRows !== 1) log(txnId, `CẢNH BÁO: chuyển ${from} -> ${to} không áp dụng được (trạng thái đã đổi)`);
  else log(txnId, `FSM: ${from} -> ${to}${reason ? ` (${reason})` : ''}`);
  return r.affectedRows === 1;
}

// Một giao dịch lỗi: ghi FAILED rồi trả response lỗi
async function fail(res, txnId, httpStatus, code, message, reason = message) {
  try { await transition(txnId, 'PROCESSING', 'FAILED', { reason }); }
  catch (e) { console.error(`[Payment Service] [${txnId}] Không ghi được FAILED:`, e.message); }
  return res.status(httpStatus).json({ success: false, code, message, transaction_id: txnId, transaction_status: 'FAILED' });
}

function newTransactionId() {
  return `TXN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// 1. KHỞI TẠO GIAO DỊCH
// ---------------------------------------------------------------------------
async function initiateHandler(req, res) {
  const { user_id, fee_id, student_id, amount } = req.body || {};
  const amt = Number(amount);
  if (!isNonEmptyString(user_id) || !isNonEmptyString(fee_id) || !isNonEmptyString(student_id)) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu user_id / fee_id / student_id' });
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', message: 'Số tiền phải là số dương' });
  }

  try {
    // Pre-check (read-only, DB dùng chung): user + số dư
    const [users] = await pool.query('SELECT user_id, email, balance FROM users WHERE user_id = ?', [user_id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'Người dùng không tồn tại' });
    }
    const user = users[0];
    if (Number(user.balance) < amt) {
      return res.status(400).json({ success: false, code: 'INSUFFICIENT_BALANCE', message: 'Số dư không đủ để thanh toán' });
    }

    // Pre-check học phí
    const [fees] = await pool.query('SELECT fee_id, student_id, price, status FROM tuition_fees WHERE fee_id = ?', [fee_id]);
    if (fees.length === 0) {
      return res.status(404).json({ success: false, code: 'FEE_NOT_FOUND', message: 'Không tìm thấy khoản học phí' });
    }
    const fee = fees[0];
    if (fee.student_id !== student_id) {
      return res.status(400).json({ success: false, code: 'FEE_STUDENT_MISMATCH', message: 'Khoản học phí không thuộc sinh viên này' });
    }
    if (fee.status === STATUS_PAID) {
      return res.status(409).json({ success: false, code: 'ALREADY_PAID', message: 'Khoản học phí này đã được thanh toán' });
    }
    if (Math.round(Number(fee.price) * 100) !== Math.round(amt * 100)) {
      return res.status(400).json({ success: false, code: 'AMOUNT_MISMATCH', message: 'Số tiền không khớp với khoản học phí' });
    }

    // Tạo giao dịch PENDING_OTP (retry nếu trùng khóa — xác suất cực thấp)
    let txnId = null;
    for (let i = 0; i < 3 && !txnId; i++) {
      const candidate = newTransactionId();
      try {
        await pool.query(
          "INSERT INTO transactions (transaction_id, user_id, fee_id, student_id, amount, status) VALUES (?, ?, ?, ?, ?, 'PENDING_OTP')",
          [candidate, user_id, fee_id, student_id, amt]
        );
        txnId = candidate;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    if (!txnId) throw new Error('Không sinh được transaction_id duy nhất');
    log(txnId, `Tạo giao dịch PENDING_OTP (user=${user_id}, fee=${fee_id}, amount=${amt})`);

    // Nhờ Notification Service sinh & gửi OTP
    const otp = await callService('Notification', urls().notification, '/send-otp', { transaction_id: txnId, email: user.email, amount: amt });
    if (!otp.ok) {
      const reason = `Không gửi được OTP: ${otp.data?.message || otp.networkError || 'lỗi không xác định'}`;
      await transition(txnId, 'PENDING_OTP', 'FAILED', { reason });
      return res.status(502).json({ success: false, code: 'OTP_SEND_FAILED', message: 'Không thể gửi OTP, vui lòng thử lại', transaction_id: txnId });
    }

    return res.json({ success: true, message: 'Đã gửi OTP', transaction_id: txnId, amount: amt, email: user.email, expires_in: otp.data?.data?.expires_in ?? 300 });
  } catch (err) {
    console.error('[Payment Service] Lỗi initiate:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server' });
  }
}

// ---------------------------------------------------------------------------
// 2. XÁC THỰC OTP & THANH TOÁN (FSM + Saga)
// ---------------------------------------------------------------------------
async function verifyAndPayHandler(req, res) {
  const { transaction_id, otp_code } = req.body || {};
  if (!isNonEmptyString(transaction_id) || typeof otp_code !== 'string' || !otp_code.trim()) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu transaction_id hoặc otp_code' });
  }
  const txnId = transaction_id;
  let txn;

  // STEP 1: khóa dòng giao dịch và chuyển PENDING_OTP -> PROCESSING (atomic)
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM transactions WHERE transaction_id = ? FOR UPDATE', [txnId]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, code: 'TRANSACTION_NOT_FOUND', message: 'Không tìm thấy giao dịch' });
    }
    txn = rows[0];
    if (txn.status !== 'PENDING_OTP') {
      await connection.rollback();
      const messages = {
        PROCESSING: 'Giao dịch đang được xử lý, vui lòng không gửi lại',
        COMPLETED: 'Giao dịch đã hoàn tất trước đó',
        CANCELLED: 'Giao dịch đã bị hủy',
        FAILED: 'Giao dịch đã thất bại trước đó'
      };
      log(txnId, `Từ chối verify-and-pay: trạng thái hiện tại ${txn.status}`);
      return res.status(409).json({ success: false, code: `TRANSACTION_${txn.status}`, message: messages[txn.status] || 'Trạng thái giao dịch không hợp lệ', transaction_status: txn.status });
    }
    await connection.query("UPDATE transactions SET status = 'PROCESSING' WHERE transaction_id = ?", [txnId]);
    await connection.commit();
    log(txnId, 'FSM: PENDING_OTP -> PROCESSING');
  } catch (err) {
    await connection.rollback().catch(() => {});
    console.error('[Payment Service] Lỗi khóa giao dịch:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server' });
  } finally {
    connection.release();
  }

  // Từ đây giao dịch thuộc về request này; mọi nhánh lỗi phải kết thúc ở FAILED hoặc COMPLETED.
  try {
    const { auth, tuition, notification } = urls();

    // STEP 2: xác thực OTP
    const otp = await callService('Notification', notification, '/verify-otp', { transaction_id: txnId, otp_code });
    if (!otp.ok) {
      if (otp.networkError) return fail(res, txnId, 503, 'NOTIFICATION_UNAVAILABLE', 'Dịch vụ xác thực OTP không khả dụng', 'Không kết nối được Notification Service');
      const code = otp.data?.code || 'OTP_INVALID';
      const msg = otp.data?.message || 'Xác thực OTP thất bại';
      return fail(res, txnId, otp.status >= 400 && otp.status < 500 ? otp.status : 502, code, msg, `Xác thực OTP thất bại (${code}): ${msg}`);
    }
    log(txnId, 'OTP hợp lệ');

    // STEP 3: gạch nợ học phí (chống Double Payment)
    const mark = await callService('Tuition', tuition, '/internal/mark-paid', { fee_id: txn.fee_id, transaction_id: txnId });
    if (!mark.ok) {
      if (mark.status === 409) {
        return fail(res, txnId, 409, mark.data?.code || 'ALREADY_PAID', REASON_ALREADY_PAID, REASON_ALREADY_PAID);
      }
      if (mark.status === 404) return fail(res, txnId, 404, 'FEE_NOT_FOUND', 'Không tìm thấy khoản học phí');
      // Lỗi mạng/timeout: chưa rõ tuition đã gạch nợ hay chưa. KHÔNG revert mù vì revert-paid
      // không kiểm tra chủ sở hữu và có thể xóa nợ đã trả hợp lệ của người khác -> cần đối soát.
      if (mark.networkError) console.error(`[Payment Service] [${txnId}] CẢNH BÁO: kết quả mark-paid không xác định, cần đối soát fee ${txn.fee_id}`);
      return fail(res, txnId, 503, 'TUITION_UNAVAILABLE', 'Dịch vụ học phí không khả dụng', `Gạch nợ học phí thất bại: ${mark.data?.message || mark.networkError || 'lỗi'}`);
    }
    log(txnId, `Đã gạch nợ học phí ${txn.fee_id}`);

    // STEP 4: trừ tiền (chống Double Spending ở Auth Service)
    const deduct = await callService('Auth', auth, '/internal/deduct', { user_id: txn.user_id, amount: Number(txn.amount), transaction_id: txnId });
    if (!deduct.ok) {
      // SAGA BÙ HOÀN: học phí đã gạch nợ nhưng trừ tiền thất bại -> hoàn tác học phí
      const underlying = deduct.data?.message || deduct.networkError || 'lỗi không xác định';
      const insufficient = deduct.status === 400;
      log(txnId, `Trừ tiền thất bại (${underlying}) -> SAGA: hoàn tác học phí ${txn.fee_id}`);

      let reverted = false;
      for (let i = 0; i < 3 && !reverted; i++) {
        const rv = await callService('Tuition', tuition, '/internal/revert-paid', { fee_id: txn.fee_id, transaction_id: txnId });
        reverted = rv.ok;
        if (!reverted) await sleep(300 * (i + 1));
      }
      if (!reverted) {
        console.error(`[Payment Service] [${txnId}] CRITICAL: bù hoàn THẤT BẠI, học phí ${txn.fee_id} có thể đang bị gạch nợ sai -> CẦN ĐỐI SOÁN THỦ CÔNG`);
        return fail(res, txnId, 500, 'COMPENSATION_FAILED', 'Lỗi hệ thống, giao dịch cần được đối soát', `Trừ tiền thất bại (${underlying}); bù hoàn học phí thất bại - cần đối soát thủ công`);
      }
      log(txnId, 'SAGA: đã hoàn tác học phí về "Chưa thanh toán"');
      const reason = insufficient ? 'Số dư không đủ' : `Trừ tiền thất bại: ${underlying}`;
      return fail(res, txnId, deduct.status >= 400 && deduct.status < 500 ? deduct.status : 502, insufficient ? 'INSUFFICIENT_BALANCE' : 'DEDUCT_FAILED', reason, reason);
    }
    log(txnId, `Đã trừ tiền, số dư mới ${deduct.data?.data?.new_balance}`);

    // STEP 5: hoàn tất — chỉ đến đây mới được COMPLETED
    let completed = false;
    for (let i = 0; i < 2 && !completed; i++) {
      try { completed = await transition(txnId, 'PROCESSING', 'COMPLETED', { completed: true }); }
      catch (e) { console.error(`[Payment Service] [${txnId}] Lỗi ghi COMPLETED (lần ${i + 1}):`, e.message); }
    }
    if (!completed) {
      console.error(`[Payment Service] [${txnId}] CRITICAL: đã gạch nợ + trừ tiền nhưng không ghi được COMPLETED -> CẦN ĐỐI SOÁN`);
      return res.status(500).json({ success: false, code: 'COMPLETION_NOT_RECORDED', message: 'Thanh toán đã xử lý nhưng chưa ghi nhận, vui lòng liên hệ hỗ trợ', transaction_id: txnId });
    }

    // Lấy thông tin cho biên lai
    const [info] = await pool.query(
      `SELECT u.full_name, u.email, s.student_name, f.type_of_fee, t.completed_at
         FROM transactions t
         JOIN users u ON u.user_id = t.user_id
         LEFT JOIN students s ON s.student_id = t.student_id
         LEFT JOIN tuition_fees f ON f.fee_id = t.fee_id
        WHERE t.transaction_id = ?`, [txnId]);
    const i = info[0] || {};

    // Gửi biên lai bất đồng bộ: KHÔNG await, lỗi chỉ được log
    callService('Notification', notification, '/send-receipt', {
      email: i.email, transaction_id: txnId, full_name: i.full_name,
      student_id: txn.student_id, student_name: i.student_name, amount: Number(txn.amount)
    }).then((r) => {
      if (r.ok) log(txnId, 'Đã gửi email biên lai');
      else console.error(`[Payment Service] [${txnId}] Gửi biên lai thất bại (giao dịch vẫn COMPLETED): ${r.data?.message || r.networkError}`);
    });

    return res.json({
      success: true,
      message: 'Thanh toán học phí thành công',
      data: {
        transactionId: txnId,
        status: 'COMPLETED',
        amount: Number(txn.amount),
        feeId: txn.fee_id,
        typeOfFee: i.type_of_fee,
        studentId: txn.student_id,
        studentName: i.student_name,
        payerName: i.full_name,
        email: i.email,
        newBalance: deduct.data?.data?.new_balance,
        completedAt: i.completed_at
      }
    });
  } catch (err) {
    console.error(`[Payment Service] [${txnId}] Lỗi không mong đợi sau khi PROCESSING:`, err);
    // Không rõ đã đi tới bước nào -> không đoán mò, đánh dấu FAILED để cần đối soát
    return fail(res, txnId, 500, 'INTERNAL_ERROR', 'Lỗi server', `Lỗi nội bộ: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. HỦY GIAO DỊCH
// ---------------------------------------------------------------------------
async function cancelHandler(req, res) {
  const { transaction_id } = req.body || {};
  if (!isNonEmptyString(transaction_id)) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu transaction_id' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Cùng khóa dòng với verify-and-pay: hủy và thanh toán không thể chạy chồng nhau
    const [rows] = await connection.query('SELECT status FROM transactions WHERE transaction_id = ? FOR UPDATE', [transaction_id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, code: 'TRANSACTION_NOT_FOUND', message: 'Không tìm thấy giao dịch' });
    }
    if (rows[0].status !== 'PENDING_OTP') {
      await connection.rollback();
      return res.status(409).json({ success: false, code: 'INVALID_STATE_TRANSITION', message: `Không thể hủy giao dịch đang ở trạng thái ${rows[0].status}`, transaction_status: rows[0].status });
    }
    await connection.query("UPDATE transactions SET status = 'CANCELLED' WHERE transaction_id = ?", [transaction_id]);
    await connection.commit();
    log(transaction_id, 'FSM: PENDING_OTP -> CANCELLED');
  } catch (err) {
    await connection.rollback().catch(() => {});
    console.error('[Payment Service] Lỗi hủy giao dịch:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server' });
  } finally {
    connection.release();
  }

  // Vô hiệu hóa OTP. Dù bước này lỗi, giao dịch đã CANCELLED nên verify-and-pay vẫn từ chối.
  const r = await callService('Notification', urls().notification, '/cancel-otp', { transaction_id });
  if (!r.ok) console.error(`[Payment Service] [${transaction_id}] Hủy OTP thất bại (giao dịch vẫn CANCELLED, OTP không thể dùng vì FSM chặn)`);
  return res.json({ success: true, message: 'Đã hủy giao dịch', transaction_id, transaction_status: 'CANCELLED', otp_invalidated: r.ok });
}

// ---------------------------------------------------------------------------
// 4. GỬI LẠI OTP (cho nút "Gửi lại mã" ở frontend)
// ---------------------------------------------------------------------------
async function resendOtpHandler(req, res) {
  const { transaction_id } = req.body || {};
  if (!isNonEmptyString(transaction_id)) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu transaction_id' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT t.status, t.amount, u.email FROM transactions t JOIN users u ON u.user_id = t.user_id WHERE t.transaction_id = ?',
      [transaction_id]);
    if (rows.length === 0) return res.status(404).json({ success: false, code: 'TRANSACTION_NOT_FOUND', message: 'Không tìm thấy giao dịch' });
    if (rows[0].status !== 'PENDING_OTP') {
      return res.status(409).json({ success: false, code: 'INVALID_STATE_TRANSITION', message: `Không thể gửi lại OTP cho giao dịch ${rows[0].status}` });
    }
    const r = await callService('Notification', urls().notification, '/send-otp', { transaction_id, email: rows[0].email, amount: Number(rows[0].amount) });
    if (!r.ok) return res.status(r.status === 409 ? 409 : 502).json({ success: false, code: 'OTP_SEND_FAILED', message: 'Không thể gửi lại OTP' });
    return res.json({ success: true, message: 'Đã gửi lại OTP', transaction_id, email: rows[0].email, expires_in: r.data?.data?.expires_in ?? 300 });
  } catch (err) {
    console.error('[Payment Service] Lỗi resend-otp:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server' });
  }
}

// ---------------------------------------------------------------------------
// 5. LỊCH SỬ GIAO DỊCH
// ---------------------------------------------------------------------------
async function historyHandler(req, res) {
  const userId = req.params.user_id;
  try {
    const [users] = await pool.query('SELECT 1 FROM users WHERE user_id = ?', [userId]);
    if (users.length === 0) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'Người dùng không tồn tại' });

    const [rows] = await pool.query(
      `SELECT t.transaction_id, t.student_id, s.student_name, t.fee_id, f.type_of_fee, f.description,
              t.amount, t.status, t.failure_reason, t.created_at, t.completed_at
         FROM transactions t
         LEFT JOIN students s ON s.student_id = t.student_id
         LEFT JOIN tuition_fees f ON f.fee_id = t.fee_id
        WHERE t.user_id = ?
        ORDER BY t.created_at DESC, t.transaction_id DESC`, [userId]);

    return res.json({
      success: true,
      data: rows.map((r) => ({
        transactionId: r.transaction_id,
        studentId: r.student_id,
        studentName: r.student_name,
        feeId: r.fee_id,
        typeOfFee: r.type_of_fee,
        description: r.description,
        amount: Number(r.amount),
        status: r.status,
        failureReason: r.failure_reason,
        createdAt: r.created_at,
        completedAt: r.completed_at
      }))
    });
  } catch (err) {
    console.error('[Payment Service] Lỗi lịch sử:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server' });
  }
}

app.post('/api/payment/initiate', initiateHandler);
app.post('/initiate', initiateHandler); // alias theo README
app.post('/api/payment/verify-and-pay', verifyAndPayHandler);
app.post('/api/payment/cancel', cancelHandler);
app.post('/api/payment/resend-otp', resendOtpHandler);
app.get('/api/payment/history/:user_id', historyHandler);
app.get('/health', (req, res) => res.json({ success: true, service: 'payment-service' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[Payment Service] Lỗi không mong đợi:', err);
  res.status(status).json({ success: false, code: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: status === 400 ? 'Body JSON không hợp lệ' : 'Lỗi server' });
});

app.listen(PORT, async () => {
  await testConnection();
  console.log(`[Payment Service] Server is running on port ${PORT}`);
});
