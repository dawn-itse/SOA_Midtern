// Nhiệm vụ: Quản lý OTP 6 số (sinh, lưu, xác thực, hết hạn, hủy) và gửi email (OTP + biên lai)
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { pool, testConnection } from './db.js';
import { sendMail, isSmtpConfigured, logMailerMode } from './mailer.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8004;
const OTP_TTL_SECONDS = 300; // OTP có hạn đúng 5 phút

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Notification Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next();
});

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isEmail = (v) => isNonEmptyString(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const formatVND = (n) => new Intl.NumberFormat('vi-VN').format(Number(n)) + ' VND';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Sinh OTP 6 chữ số ngẫu nhiên bằng CSPRNG, không trùng với OTP nào đang PENDING còn hạn
async function generateUniqueOtp(connection) {
  for (let i = 0; i < 10; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    const [rows] = await connection.query(
      "SELECT 1 FROM otps WHERE otp_code = ? AND status = 'PENDING' AND expired_at > NOW() LIMIT 1",
      [code]
    );
    if (rows.length === 0) return code;
  }
  throw new Error('Không thể sinh OTP không trùng sau 10 lần thử');
}

// 1. Sinh & gửi OTP
app.post('/send-otp', async (req, res) => {
  const { transaction_id, email, amount } = req.body || {};
  const amt = Number(amount);
  if (!isNonEmptyString(transaction_id) || !isEmail(email) || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu hoặc sai transaction_id / email / amount' });
  }

  const connection = await pool.getConnection();
  let otpId, otpCode;
  try {
    await connection.beginTransaction();

    // Khóa dòng giao dịch để các lần gửi/gửi lại OTP của cùng 1 giao dịch được xếp hàng tuần tự
    const [txRows] = await connection.query(
      'SELECT status FROM transactions WHERE transaction_id = ? FOR UPDATE',
      [transaction_id]
    );
    if (txRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, code: 'TRANSACTION_NOT_FOUND', message: 'Không tìm thấy giao dịch' });
    }
    if (txRows[0].status !== 'PENDING_OTP') {
      await connection.rollback();
      return res.status(409).json({ success: false, code: 'INVALID_TRANSACTION_STATE', message: `Giao dịch đang ở trạng thái ${txRows[0].status}, không thể gửi OTP` });
    }

    // Vô hiệu hóa OTP cũ còn PENDING của giao dịch này
    const [inv] = await connection.query(
      "UPDATE otps SET status = 'EXPIRED' WHERE transaction_id = ? AND status = 'PENDING'",
      [transaction_id]
    );
    if (inv.affectedRows > 0) {
      console.log(`[Notification Service] Đã vô hiệu hóa ${inv.affectedRows} OTP cũ của ${transaction_id}`);
    }

    otpCode = await generateUniqueOtp(connection);
    otpId = `OTP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await connection.query(
      "INSERT INTO otps (otp_id, transaction_id, otp_code, status, expired_at) VALUES (?, ?, ?, 'PENDING', DATE_ADD(NOW(), INTERVAL ? SECOND))",
      [otpId, transaction_id, otpCode, OTP_TTL_SECONDS]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback().catch(() => {});
    console.error('[Notification Service] Lỗi tạo OTP:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server khi tạo OTP' });
  } finally {
    connection.release();
  }

  // Gửi email SAU khi commit để không giữ khóa DB trong lúc chờ SMTP
  try {
    const text = `Xin chào,\n\nMã OTP xác nhận thanh toán học phí ${formatVND(amt)} của bạn là: ${otpCode}\nMã có hiệu lực trong 5 phút. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.\n\nMã giao dịch: ${transaction_id}\n\nTDTU iBanking`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px"><h2>Xác nhận thanh toán học phí</h2><p>Số tiền: <b>${escapeHtml(formatVND(amt))}</b></p><p>Mã OTP của bạn:</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${otpCode}</p><p>Mã có hiệu lực trong <b>5 phút</b>. Không chia sẻ mã này cho bất kỳ ai.</p><p style="color:#888;font-size:12px">Mã giao dịch: ${escapeHtml(transaction_id)}</p></div>`;
    const result = await sendMail({ to: email.trim(), subject: '[TDTU iBanking] Mã OTP xác nhận thanh toán học phí', text, html });
    if (result.mode === 'simulator') {
      console.log(`[Notification Service] [OTP SIMULATOR] GD ${transaction_id} -> OTP = ${otpCode} (hết hạn sau 5 phút)`);
    }
    return res.json({ success: true, message: 'OTP sent successfully', data: { transaction_id, expires_in: OTP_TTL_SECONDS } });
  } catch (err) {
    // Gửi mail thất bại -> OTP không tới được người dùng, hủy luôn OTP này
    console.error('[Notification Service] Gửi email OTP thất bại:', err.message);
    await pool.query("UPDATE otps SET status = 'EXPIRED' WHERE otp_id = ? AND status = 'PENDING'", [otpId]).catch(() => {});
    return res.status(502).json({ success: false, code: 'EMAIL_SEND_FAILED', message: 'Không thể gửi email OTP' });
  }
});

// 2. Xác thực OTP (dùng 1 lần)
app.post('/verify-otp', async (req, res) => {
  const { transaction_id, otp_code } = req.body || {};
  if (!isNonEmptyString(transaction_id) || typeof otp_code !== 'string' || !/^\d{6}$/.test(otp_code)) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu transaction_id hoặc otp_code không phải 6 chữ số' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // FOR UPDATE: 2 request verify cùng lúc sẽ xếp hàng, request sau thấy OTP đã VERIFIED
    const [rows] = await connection.query(
      "SELECT otp_id, otp_code, (expired_at <= NOW()) AS is_expired FROM otps WHERE transaction_id = ? AND status = 'PENDING' ORDER BY created_at DESC, otp_id DESC LIMIT 1 FOR UPDATE",
      [transaction_id]
    );

    if (rows.length === 0) {
      // Không còn OTP PENDING: tìm OTP gần nhất để trả lỗi chính xác
      const [last] = await connection.query(
        'SELECT status FROM otps WHERE transaction_id = ? ORDER BY created_at DESC, otp_id DESC LIMIT 1',
        [transaction_id]
      );
      await connection.rollback();
      if (last.length === 0) {
        return res.status(404).json({ success: false, code: 'OTP_NOT_FOUND', message: 'Không tìm thấy OTP của giao dịch này' });
      }
      if (last[0].status === 'VERIFIED') {
        return res.status(400).json({ success: false, code: 'OTP_ALREADY_USED', message: 'OTP đã được sử dụng' });
      }
      return res.status(400).json({ success: false, code: 'OTP_EXPIRED', message: 'OTP đã hết hạn hoặc đã bị vô hiệu hóa' });
    }

    const otp = rows[0];

    if (otp.is_expired) {
      await connection.query("UPDATE otps SET status = 'EXPIRED' WHERE otp_id = ?", [otp.otp_id]);
      await connection.commit(); // phải commit để lưu trạng thái EXPIRED
      console.log(`[Notification Service] OTP ${otp.otp_id} của ${transaction_id} đã hết hạn -> EXPIRED`);
      return res.status(400).json({ success: false, code: 'OTP_EXPIRED', message: 'OTP đã hết hạn' });
    }

    if (otp.otp_code !== otp_code) {
      await connection.rollback();
      console.log(`[Notification Service] OTP sai cho giao dịch ${transaction_id}`);
      return res.status(400).json({ success: false, code: 'OTP_MISMATCH', message: 'Mã OTP không chính xác' });
    }

    // Điều kiện status = 'PENDING' trong UPDATE là lớp bảo vệ thứ 2 chống verify 2 lần
    const [upd] = await connection.query(
      "UPDATE otps SET status = 'VERIFIED' WHERE otp_id = ? AND status = 'PENDING'",
      [otp.otp_id]
    );
    if (upd.affectedRows !== 1) {
      await connection.rollback();
      return res.status(400).json({ success: false, code: 'OTP_ALREADY_USED', message: 'OTP đã được sử dụng' });
    }
    await connection.commit();
    console.log(`[Notification Service] OTP của ${transaction_id} xác thực thành công -> VERIFIED`);
    return res.json({ success: true, message: 'Xác thực OTP thành công', data: { transaction_id } });
  } catch (err) {
    await connection.rollback().catch(() => {});
    console.error('[Notification Service] Lỗi xác thực OTP:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server khi xác thực OTP' });
  } finally {
    connection.release();
  }
});

// 3. Hủy OTP (khi người dùng hủy giao dịch)
app.post('/cancel-otp', async (req, res) => {
  const { transaction_id } = req.body || {};
  if (!isNonEmptyString(transaction_id)) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu transaction_id' });
  }
  try {
    const [result] = await pool.query(
      "UPDATE otps SET status = 'EXPIRED' WHERE transaction_id = ? AND status = 'PENDING'",
      [transaction_id]
    );
    console.log(`[Notification Service] Hủy OTP của ${transaction_id}: ${result.affectedRows} OTP bị vô hiệu hóa`);
    return res.json({ success: true, message: 'Đã hủy OTP', data: { transaction_id, cancelled: result.affectedRows } });
  } catch (err) {
    console.error('[Notification Service] Lỗi hủy OTP:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Lỗi server khi hủy OTP' });
  }
});

// 4. Gửi biên lai (thông báo sau thanh toán — lỗi ở đây KHÔNG ảnh hưởng giao dịch)
app.post('/send-receipt', async (req, res) => {
  const { email, transaction_id, full_name, student_id, student_name, amount } = req.body || {};
  const amt = Number(amount);
  if (!isEmail(email) || !isNonEmptyString(transaction_id) || !isNonEmptyString(full_name) ||
      !isNonEmptyString(student_id) || !isNonEmptyString(student_name) || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Thiếu hoặc sai thông tin biên lai' });
  }

  const time = new Date().toLocaleString('vi-VN');
  const text = [
    'BIÊN LAI THANH TOÁN HỌC PHÍ - TDTU iBanking',
    '',
    'Giao dịch của bạn đã được thực hiện THÀNH CÔNG.',
    '',
    `Mã giao dịch   : ${transaction_id}`,
    `Thời gian      : ${time}`,
    `Người nộp tiền : ${full_name}`,
    `MSSV           : ${student_id}`,
    `Sinh viên      : ${student_name}`,
    `Số tiền        : ${formatVND(amt)}`,
    '',
    'Cảm ơn bạn đã sử dụng dịch vụ.'
  ].join('\n');
  const row = (k, v) => `<tr><td style="padding:6px 12px;color:#666">${k}</td><td style="padding:6px 12px"><b>${escapeHtml(v)}</b></td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="color:#059669">Giao dịch thành công</h2><p>Biên lai thanh toán học phí - TDTU iBanking</p><table style="border-collapse:collapse;border:1px solid #ddd">${row('Mã giao dịch', transaction_id)}${row('Thời gian', time)}${row('Người nộp tiền', full_name)}${row('MSSV', student_id)}${row('Sinh viên', student_name)}${row('Số tiền', formatVND(amt))}</table><p>Cảm ơn bạn đã sử dụng dịch vụ.</p></div>`;

  try {
    const result = await sendMail({ to: email.trim(), subject: `[TDTU iBanking] Biên lai thanh toán ${transaction_id}`, text, html });
    return res.json({ success: true, message: 'Receipt sent successfully', data: { transaction_id, mode: result.mode } });
  } catch (err) {
    console.error(`[Notification Service] Gửi biên lai cho ${transaction_id} thất bại:`, err.message);
    return res.status(502).json({ success: false, code: 'EMAIL_SEND_FAILED', message: 'Không thể gửi email biên lai' });
  }
});

app.get('/health', (req, res) => res.json({ success: true, service: 'notification-service', smtp: isSmtpConfigured() }));

// JSON lỗi thay vì HTML (vd: body JSON sai cú pháp)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[Notification Service] Lỗi không mong đợi:', err);
  res.status(status).json({ success: false, code: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: status === 400 ? 'Body JSON không hợp lệ' : 'Lỗi server' });
});

app.listen(PORT, async () => {
  await testConnection();
  logMailerMode();
  console.log(`[Notification Service] Server is running on port ${PORT}`);
});
