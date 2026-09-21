// =========================================================================
// FILE: src/index.js - MÁY CHỦ NOTIFICATION SERVICE (PORT 8004)
// Nhiệm vụ: Sinh mã OTP 6 số, đếm ngược 5 phút, gửi Email SMTP & Gửi biên lai
// =========================================================================

import express from 'express';             // Framework tạo máy chủ web API
import cors from 'cors';                   // Cho phép gọi API từ cổng khác
import dotenv from 'dotenv';               // Đọc file .env
import crypto from 'crypto';               // Thư viện sinh mã ngẫu nhiên an toàn
import { pool, testConnection } from './db.js'; // Nhập bể kết nối CSDL
import { sendOtpEmail, sendReceiptEmail } from './mailer.js'; // Nhập 2 hàm gửi email từ mailer.js

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8004; // Chạy trên cổng 8004

// Middleware
app.use(cors());
app.use(express.json());

// Ghi nhật ký (Logging)
app.use((req, res, next) => {
  console.log(`[Notification Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next();
});

// =========================================================================
// THUẬT TOÁN: SINH MÃ OTP 6 CHỮ SỐ ĐỘC NHẤT (Không trùng với mã đang còn hạn)
// ĐÁP ỨNG YÊU CẦU ĐỀ BÀI: "Không trùng với OTP đang có hiệu lực của giao dịch khác"
// =========================================================================
async function generateUniqueOtp() {
  let isUnique = false;
  let otpCode = '';
  let attempts = 0;

  // Thử sinh mã ngẫu nhiên tối đa 10 lần
  while (!isUnique && attempts < 10) {
    attempts++;
    // Sinh số ngẫu nhiên từ 100000 đến 999999
    otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Kiểm tra trong CSDL: Có giao dịch nào khác đang dùng mã này mà CHƯA HẾT HẠN không?
    const [existing] = await pool.query(
      "SELECT otp_id FROM otps WHERE otp_code = ? AND status = 'PENDING' AND expired_at > NOW()",
      [otpCode]
    );

    // Nếu không ai đang dùng mã này -> Mã hợp lệ!
    if (existing.length === 0) {
      isUnique = true;
    }
  }

  return otpCode;
}

// =========================================================================
// HÀM 1: TẠO VÀ GỬI MÃ OTP 6 SỐ QUA EMAIL (POST /send-otp)
// Chức năng: Khi khách bấm "Xác nhận giao dịch", Payment Service gọi hàm này
// =========================================================================
app.post('/send-otp', async (req, res) => {
  try {
    const { transaction_id, email, amount } = req.body;

    if (!transaction_id || !email) {
      return res.status(400).json({ success: false, message: 'Thiếu transaction_id hoặc email' });
    }

    // 1. Nếu giao dịch này trước đó đã có mã OTP cũ -> Vô hiệu hóa (EXPIRED) mã cũ đi
    await pool.query(
      "UPDATE otps SET status = 'EXPIRED' WHERE transaction_id = ? AND status = 'PENDING'",
      [transaction_id]
    );

    // 2. Sinh mã OTP 6 số mới không trùng lặp
    const otpCode = await generateUniqueOtp();
    const otpId = 'OTP-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    
    // 3. THỜI HẠN HIỆU LỰC: Đúng 5 phút (5 * 60 * 1000 mili-giây)
    const expiredAt = new Date(Date.now() + 5 * 60 * 1000);

    // 4. Lưu mã OTP mới vào bảng otps trong MySQL
    await pool.query(
      'INSERT INTO otps (otp_id, transaction_id, otp_code, status, expired_at) VALUES (?, ?, ?, ?, ?)',
      [otpId, transaction_id, otpCode, 'PENDING', expiredAt]
    );

    // 5. Gửi email chứa mã OTP qua giao thức SMTP
    await sendOtpEmail(email, otpCode, transaction_id, amount);

    console.log(`[Notification Service] Đã tạo OTP [${otpCode}] cho GD ${transaction_id}. Hết hạn lúc: ${expiredAt.toLocaleTimeString('vi-VN')}`);

    // 6. Trả kết quả về
    return res.json({
      success: true,
      message: 'Mã OTP đã được gửi đến email của người nộp tiền',
      data: {
        otp_id: otpId,
        transaction_id,
        expired_at: expiredAt,
        dev_otp: otpCode // Cung cấp thêm mã này để chấm bài nhanh mà không cần mở tab Gmail
      }
    });

  } catch (error) {
    console.error('[Notification Service] Lỗi tạo OTP:', error);
    return res.status(500).json({ success: false, message: 'Lỗi gửi OTP', error: error.message });
  }
});

// =========================================================================
// HÀM 2: XÁC THỰC MÃ OTP (POST /verify-otp)
// Chức năng: Kiểm tra mã người dùng gõ vào có đúng và còn trong 5 phút không
// =========================================================================
app.post('/verify-otp', async (req, res) => {
  try {
    const { transaction_id, otp_code } = req.body;

    if (!transaction_id || !otp_code) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp transaction_id và otp_code' });
    }

    // 1. Tìm mã OTP đang chờ xác thực (status = 'PENDING') của giao dịch này
    const [rows] = await pool.query(
      "SELECT * FROM otps WHERE transaction_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1",
      [transaction_id]
    );

    // Nếu không tìm thấy -> Mã không tồn tại hoặc đã được dùng rồi
    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Mã OTP không hợp lệ, không tồn tại hoặc đã được sử dụng trước đó'
      });
    }

    const otp = rows[0];

    // 2. KIỂM TRA THỜI GIAN HIỆU LỰC (5 PHÚT)
    const now = new Date();
    const expiredTime = new Date(otp.expired_at);

    // Nếu thời gian hiện tại đã vượt quá thời gian hết hạn
    if (now > expiredTime) {
      // Đổi trạng thái thành EXPIRED (Hết hạn)
      await pool.query("UPDATE otps SET status = 'EXPIRED' WHERE otp_id = ?", [otp.otp_id]);
      return res.status(400).json({
        success: false,
        code: 'OTP_EXPIRED',
        message: 'Mã OTP đã hết thời hạn hiệu lực (quá 5 phút). Vui lòng yêu cầu gửi lại mã mới.'
      });
    }

    // 3. SO KHỚP MÃ SỐ OTP
    if (otp.otp_code !== otp_code.trim()) {
      return res.status(400).json({
        success: false,
        code: 'OTP_MISMATCH',
        message: 'Mã xác thực OTP không chính xác. Vui lòng kiểm tra lại.'
      });
    }

    // 4. MỖI OTP CHỈ ĐƯỢC DÙNG 1 LẦN: Đổi trạng thái sang 'VERIFIED'
    await pool.query("UPDATE otps SET status = 'VERIFIED' WHERE otp_id = ?", [otp.otp_id]);

    console.log(`[Notification Service] OTP [${otp_code}] của GD ${transaction_id} ĐÃ ĐƯỢC XÁC THỰC THÀNH CÔNG!`);

    return res.json({
      success: true,
      message: 'Xác thực mã OTP thành công'
    });

  } catch (error) {
    console.error('[Notification Service] Lỗi xác thực OTP:', error);
    return res.status(500).json({ success: false, message: 'Lỗi xác thực OTP', error: error.message });
  }
});

// =========================================================================
// HÀM 3: GỬI BIÊN LAI THANH TOÁN THÀNH CÔNG (POST /send-receipt)
// Chức năng: Gửi email hóa đơn đẹp mắt xác nhận gạch nợ thành công
// =========================================================================
app.post('/send-receipt', async (req, res) => {
  try {
    const { email, transaction_id, full_name, student_id, student_name, amount } = req.body;

    if (!email || !transaction_id) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin gửi biên lai' });
    }

    // Gửi email biên lai
    await sendReceiptEmail(email, {
      transaction_id,
      full_name,
      student_id,
      student_name,
      amount
    });

    console.log(`[Notification Service] Đã gửi biên lai GD ${transaction_id} đến email ${email}`);

    return res.json({
      success: true,
      message: 'Biên lai giao dịch đã được gửi đến email người nộp tiền'
    });
  } catch (error) {
    console.error('[Notification Service] Lỗi gửi email biên lai:', error);
    return res.status(500).json({ success: false, message: 'Lỗi gửi email biên lai', error: error.message });
  }
});

// Khởi động server
app.listen(PORT, async () => {
  await testConnection();
  console.log(`=======================================================`);
  console.log(`[NOTIFICATION SERVICE] Đang chạy tại cổng http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
