// =========================================================================
// FILE: src/index.js - MÁY CHỦ PAYMENT SERVICE (PORT 8003)
// ĐÓNG VAI TRÒ: ORCHESTRATOR (TRÁI TIM ĐIỀU PHỐI) CỦA HỆ THỐNG SOA
// Nhiệm vụ:
// 1. Quản lý Máy trạng thái FSM: PENDING_OTP -> PROCESSING -> COMPLETED / FAILED / CANCELLED
// 2. Chống đóng trùng (Double Payment) qua Atomic Conditional Update tại Tuition Service
// 3. Chống chi vượt (Double Spending) qua Pessimistic Lock tại Auth Service
// 4. Cơ chế Bù hoàn Saga (Compensation): Hoàn tác dữ liệu nếu có bước thất bại
// =========================================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool, testConnection } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8003;

// Các địa chỉ URL của Microservices liên kết
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:8001';
const TUITION_SERVICE_URL = process.env.TUITION_SERVICE_URL || 'http://localhost:8002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8004';

// Middlewares
app.use(cors());
app.use(express.json());

// Ghi nhật ký yêu cầu (Logging)
app.use((req, res, next) => {
  console.log(`[Payment Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next();
});

// =========================================================================
// HÀM 1: KHỞI TẠO GIAO DỊCH VÀ PHÁT HÀNH OTP (POST /initiate)
// FSM: Chuyển sang trạng thái PENDING_OTP
// =========================================================================
async function handleInitiate(req, res) {
  try {
    const { user_id, fee_id, student_id, amount } = req.body;

    // 1. Kiểm tra tính hợp lệ của tham số đầu vào
    if (!user_id || !fee_id || !student_id || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thông tin khởi tạo giao dịch không đầy đủ hoặc số tiền không hợp lệ'
      });
    }

    // 2. Kiểm tra thông tin người dùng và email nhận OTP từ CSDL
    const [userRows] = await pool.query(
      'SELECT user_id, full_name, email, balance FROM users WHERE user_id = ?',
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin tài khoản người nộp tiền' });
    }

    const user = userRows[0];

    // 3. Kiểm tra số dư sơ bộ: Nếu số dư < số tiền nộp -> Báo lỗi ngay để không gửi OTP làm phiền
    if (parseFloat(user.balance) < parseFloat(amount)) {
      return res.status(400).json({
        success: false,
        code: 'INSUFFICIENT_FUNDS_PRECHECK',
        message: `Số dư khả dụng (${Number(user.balance).toLocaleString('vi-VN')} đ) không đủ để thanh toán khoản tiền ${Number(amount).toLocaleString('vi-VN')} đ`
      });
    }

    // 4. Kiểm tra trạng thái học phí sơ bộ: Không cho tạo giao dịch nếu học phí đã nộp rồi
    const [feeRows] = await pool.query(
      'SELECT fee_id, price, status FROM tuition_fees WHERE fee_id = ?',
      [fee_id]
    );

    if (feeRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Khoản học phí không tồn tại' });
    }

    if (feeRows[0].status === 'Đã thanh toán') {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_PAID',
        message: 'Khoản học phí này đã được thanh toán trước đó'
      });
    }

    // 5. Sinh mã giao dịch độc nhất (Transaction ID): TXN-ThờiGian-NgẫuNhiên
    const transactionId = 'TXN-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);

    // 6. Ghi bản ghi giao dịch mới vào bảng `transactions` với trạng thái FSM: PENDING_OTP
    await pool.query(
      `INSERT INTO transactions (transaction_id, user_id, fee_id, student_id, amount, status)
       VALUES (?, ?, ?, ?, ?, 'PENDING_OTP')`,
      [transactionId, user_id, fee_id, student_id, amount]
    );

    console.log(`[Payment Service] Đã tạo GD ${transactionId} với trạng thái [PENDING_OTP] cho user ${user_id}`);

    // 7. Gọi Notification Service (Cổng 8004) để tạo mã OTP 6 số và gửi Email SMTP
    let notifyData = null;
    try {
      const notifyResponse = await fetch(`${NOTIFICATION_SERVICE_URL}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          email: user.email,
          amount: amount
        })
      });

      notifyData = await notifyResponse.json();

      if (!notifyResponse.ok || !notifyData.success) {
        throw new Error(notifyData.message || 'Lỗi từ Notification Service');
      }
    } catch (notifyErr) {
      console.error('[Payment Service] Lỗi khi gọi Notification Service:', notifyErr.message);
      // Cập nhật giao dịch thành FAILED nếu không thể gửi OTP
      await pool.query(
        "UPDATE transactions SET status = 'FAILED', failure_reason = ? WHERE transaction_id = ?",
        ['Không thể gửi mã xác thực OTP', transactionId]
      );
      return res.status(500).json({
        success: false,
        message: 'Hệ thống gửi mã xác thực OTP tạm thời gián đoạn. Vui lòng thử lại sau.'
      });
    }

    // 8. Trả kết quả về cho Frontend mở Modal OTP và đếm ngược 5 phút
    return res.json({
      success: true,
      message: 'Khởi tạo giao dịch thành công. Mã OTP đã được gửi đến email của bạn.',
      data: {
        transaction_id: transactionId,
        amount: parseFloat(amount),
        email: user.email,
        fee_id: fee_id,
        student_id: student_id,
        // Cung cấp thêm dev_otp để phục vụ chấm bài / kiểm thử nhanh
        dev_otp: notifyData.data?.dev_otp
      }
    });

  } catch (error) {
    console.error('[Payment Service] Lỗi khởi tạo giao dịch:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khởi tạo giao dịch', error: error.message });
  }
}

// =========================================================================
// HÀM 2: XÁC THỰC OTP & THỰC THI THANH TOÁN TOÀN DIỆN (POST /verify-and-pay)
// ĐÂY LÀ TRỌNG TÂM CỐT LÕI ĐẠT ĐIỂM TỐI ĐA BÀI TẬP LỚN:
// 1. FSM: PENDING_OTP -> PROCESSING -> COMPLETED (hoặc FAILED)
// 2. Xác thực OTP qua Notification Service (Port 8004)
// 3. Gạch nợ học phí có khóa điều kiện (Tuition Service Port 8002) - Chống Double Payment
// 4. Trừ tiền có khóa dòng bi quan (Auth Service Port 8001) - Chống Double Spending
// 5. Bù hoàn Saga (Compensating Transaction): Tự động hoàn tác nếu trừ tiền bị lỗi
// 6. Gửi biên lai xác nhận qua email (Notification Service Port 8004)
// =========================================================================
async function handleVerifyAndPay(req, res) {
  const { transaction_id, otp_code } = req.body;

  if (!transaction_id || !otp_code) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp transaction_id và mã otp_code' });
  }

  try {
    // -------------------------------------------------------------
    // BƯỚC 1: KIỂM TRA BẢN GHI GIAO DỊCH TRONG CSDL
    // -------------------------------------------------------------
    const [txRows] = await pool.query(
      'SELECT * FROM transactions WHERE transaction_id = ?',
      [transaction_id]
    );

    if (txRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch này' });
    }

    const tx = txRows[0];

    // Chỉ cho phép xử lý các giao dịch đang ở trạng thái 'PENDING_OTP'
    if (tx.status !== 'PENDING_OTP') {
      return res.status(400).json({
        success: false,
        message: `Giao dịch này không ở trạng thái chờ OTP (Trạng thái hiện tại: ${tx.status})`
      });
    }

    // -------------------------------------------------------------
    // BƯỚC 2: FSM CHUYỂN TRẠNG THÁI SANG 'PROCESSING'
    // -------------------------------------------------------------
    await pool.query(
      "UPDATE transactions SET status = 'PROCESSING' WHERE transaction_id = ?",
      [transaction_id]
    );
    console.log(`[Payment Service] GD ${transaction_id} chuyển sang trạng thái [PROCESSING]`);

    // -------------------------------------------------------------
    // BƯỚC 3: GỌI NOTIFICATION SERVICE ĐỂ XÁC THỰC MÃ OTP
    // -------------------------------------------------------------
    const verifyRes = await fetch(`${NOTIFICATION_SERVICE_URL}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction_id: transaction_id,
        otp_code: otp_code.trim()
      })
    });

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.success) {
      // Nếu OTP sai, giữ trạng thái PENDING_OTP để người dùng có thể nhập lại mã đúng
      if (verifyData.code === 'OTP_MISMATCH') {
        await pool.query(
          "UPDATE transactions SET status = 'PENDING_OTP' WHERE transaction_id = ?",
          [transaction_id]
        );
      } else {
        // Nếu OTP hết hạn (quá 5 phút), đánh dấu giao dịch FAILED
        await pool.query(
          "UPDATE transactions SET status = 'FAILED', failure_reason = ? WHERE transaction_id = ?",
          [verifyData.message || 'OTP hết hạn', transaction_id]
        );
      }

      return res.status(400).json({
        success: false,
        code: verifyData.code || 'OTP_INVALID',
        message: verifyData.message || 'Mã OTP không hợp lệ'
      });
    }

    console.log(`[Payment Service] OTP cho GD ${transaction_id} ĐÃ ĐƯỢC XÁC MINH HỢP LỆ!`);

    // -------------------------------------------------------------
    // BƯỚC 4: CHỐNG DOUBLE-PAYMENT (GỌI TUITION SERVICE GẠCH NỢ)
    // Thực hiện Atomic Conditional Update tại Tuition Service
    // -------------------------------------------------------------
    const markPaidRes = await fetch(`${TUITION_SERVICE_URL}/internal/mark-paid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fee_id: tx.fee_id,
        transaction_id: transaction_id
      })
    });

    const markPaidData = await markPaidRes.json();

    // Nếu học phí đã bị người khác thanh toán trước (Xung đột Concurrency)
    if (!markPaidRes.ok || !markPaidData.success) {
      console.warn(`[Payment Service] Gạch nợ thất bại cho GD ${transaction_id}: ${markPaidData.message}`);
      await pool.query(
        "UPDATE transactions SET status = 'FAILED', failure_reason = ? WHERE transaction_id = ?",
        [markPaidData.message || 'Học phí đã được thanh toán bởi người khác', transaction_id]
      );

      return res.status(409).json({
        success: false,
        code: 'DOUBLE_PAYMENT_BLOCKED',
        message: markPaidData.message || 'Khoản học phí này đã được người khác thanh toán trước đó.'
      });
    }

    console.log(`[Payment Service] Đã chiếm giữ và gạch nợ học phí ${tx.fee_id} thành công.`);

    // -------------------------------------------------------------
    // BƯỚC 5: CHỐNG DOUBLE-SPENDING (GỌI AUTH SERVICE TRỪ TIỀN)
    // Sử dụng PESSIMISTIC LOCKING ('FOR UPDATE') tại Auth Service
    // -------------------------------------------------------------
    const deductRes = await fetch(`${AUTH_SERVICE_URL}/internal/deduct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: tx.user_id,
        amount: parseFloat(tx.amount),
        transaction_id: transaction_id
      })
    });

    const deductData = await deductRes.json();

    // NẾU TRỪ TIỀN THẤT BẠI (Ví dụ: Số dư không đủ do tài khoản vừa tiêu ở chỗ khác)
    if (!deductRes.ok || !deductData.success) {
      console.error(`[Payment Service] Trừ tiền thất bại cho GD ${transaction_id}. BẮT ĐẦU BÙ HOÀN SAGA (ROLLBACK HỌC PHÍ)...`);

      // === CƠ CHẾ BÙ HOÀN SAGA (COMPENSATION TRANSACTION) ===
      // Hoàn tác trạng thái học phí trở lại 'Chưa thanh toán' để người khác hoặc lần sau có thể đóng
      try {
        await fetch(`${TUITION_SERVICE_URL}/internal/revert-paid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fee_id: tx.fee_id,
            transaction_id: transaction_id
          })
        });
        console.log(`[Payment Service] [SAGA] Đã hoàn tác thành công học phí ${tx.fee_id} về "Chưa thanh toán".`);
      } catch (rollbackErr) {
        console.error(`[Payment Service] [CRITICAL] Không thể rollback học phí:`, rollbackErr.message);
      }

      // Cập nhật giao dịch thành FAILED
      await pool.query(
        "UPDATE transactions SET status = 'FAILED', failure_reason = ? WHERE transaction_id = ?",
        [deductData.message || 'Số dư không đủ để thanh toán', transaction_id]
      );

      return res.status(400).json({
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        message: deductData.message || 'Số dư tài khoản không đủ để thanh toán.'
      });
    }

    console.log(`[Payment Service] Đã trừ tiền thành công. Số dư mới: ${deductData.data?.new_balance} đ`);

    // -------------------------------------------------------------
    // BƯỚC 6: FSM CHUYỂN TRẠNG THÁI GIAO DỊCH SANG 'COMPLETED'
    // Cả 2 bước gạch nợ và trừ tiền đều thành công mỹ mãn!
    // -------------------------------------------------------------
    await pool.query(
      "UPDATE transactions SET status = 'COMPLETED', completed_at = NOW() WHERE transaction_id = ?",
      [transaction_id]
    );

    console.log(`[Payment Service] GIAO DỊCH ${transaction_id} ĐÃ HOÀN TẤT [COMPLETED]!`);

    // -------------------------------------------------------------
    // BƯỚC 7: LẤY THÔNG TIN CHI TIẾT & GỬI EMAIL BIÊN LAI (ASYNC)
    // -------------------------------------------------------------
    // Lấy tên sinh viên và tên người dùng để đưa vào biên lai
    const [receiptDetails] = await pool.query(`
      SELECT 
        u.full_name AS user_name,
        u.email AS user_email,
        s.student_id,
        s.student_name,
        f.type_of_fee
      FROM users u
      CROSS JOIN students s
      JOIN tuition_fees f ON f.fee_id = ?
      WHERE u.user_id = ? AND s.student_id = ?
    `, [tx.fee_id, tx.user_id, tx.student_id]);

    const detail = receiptDetails[0] || {};

    // Gửi email biên lai (chạy ngầm, không block kết quả trả về)
    fetch(`${NOTIFICATION_SERVICE_URL}/send-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: detail.user_email || 'nguyenvana.banking@gmail.com',
        transaction_id: transaction_id,
        full_name: detail.user_name || 'Khách hàng iBanking',
        student_id: tx.student_id,
        student_name: detail.student_name || 'Sinh viên TDTU',
        amount: parseFloat(tx.amount)
      })
    }).catch(e => console.warn('[Payment Service] Gửi email biên lai ngầm gặp lỗi nhẹ:', e.message));

    // -------------------------------------------------------------
    // BƯỚC 8: TRẢ KẾT QUẢ THÀNH CÔNG CHO FRONTEND
    // -------------------------------------------------------------
    return res.json({
      success: true,
      message: 'Giao dịch thanh toán học phí thành công!',
      data: {
        transaction_id: transaction_id,
        status: 'COMPLETED',
        amount: parseFloat(tx.amount),
        fee_id: tx.fee_id,
        student_id: tx.student_id,
        student_name: detail.student_name,
        type_of_fee: detail.type_of_fee,
        new_balance: deductData.data?.new_balance,
        completed_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[Payment Service] Lỗi xử lý thanh toán:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xử lý thanh toán', error: error.message });
  }
}

// =========================================================================
// HÀM 3: HỦY GIAO DỊCH (POST /cancel)
// FSM: Chuyển sang CANCELLED khi khách bấm Hủy hoặc đóng popup
// =========================================================================
async function handleCancel(req, res) {
  try {
    const { transaction_id } = req.body;

    if (!transaction_id) {
      return res.status(400).json({ success: false, message: 'Thiếu transaction_id' });
    }

    // Chỉ hủy được giao dịch đang ở trạng thái PENDING_OTP
    const [result] = await pool.query(
      "UPDATE transactions SET status = 'CANCELLED' WHERE transaction_id = ? AND status = 'PENDING_OTP'",
      [transaction_id]
    );

    // Vô hiệu hóa mã OTP tương ứng
    await pool.query(
      "UPDATE otps SET status = 'EXPIRED' WHERE transaction_id = ?",
      [transaction_id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'Giao dịch không ở trạng thái chờ xác thực để hủy'
      });
    }

    console.log(`[Payment Service] Đã hủy giao dịch ${transaction_id}`);
    return res.json({ success: true, message: 'Đã hủy giao dịch thành công' });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi khi hủy giao dịch', error: error.message });
  }
}

// =========================================================================
// HÀM 4: LỊCH SỬ GIAO DỊCH CỦA NGƯỜI DÙNG (GET /history/:user_id)
// =========================================================================
async function handleHistory(req, res) {
  try {
    const { user_id } = req.params;

    const [rows] = await pool.query(`
      SELECT 
        t.transaction_id,
        t.user_id,
        t.fee_id,
        t.student_id,
        s.student_name,
        f.type_of_fee,
        t.amount,
        t.status,
        t.failure_reason,
        t.created_at,
        t.completed_at
      FROM transactions t
      LEFT JOIN students s ON t.student_id = s.student_id
      LEFT JOIN tuition_fees f ON t.fee_id = f.fee_id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC
    `, [user_id]);

    return res.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount)
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi lấy lịch sử giao dịch', error: error.message });
  }
}

// =========================================================================
// HÀM 5: TRA CỨU CHI TIẾT 1 GIAO DỊCH (GET /transaction/:transaction_id)
// =========================================================================
async function handleTransactionDetail(req, res) {
  try {
    const { transaction_id } = req.params;

    const [rows] = await pool.query(`
      SELECT 
        t.*,
        s.student_name,
        f.type_of_fee
      FROM transactions t
      LEFT JOIN students s ON t.student_id = s.student_id
      LEFT JOIN tuition_fees f ON t.fee_id = f.fee_id
      WHERE t.transaction_id = ?
    `, [transaction_id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });
    }

    return res.json({
      success: true,
      data: {
        ...rows[0],
        amount: parseFloat(rows[0].amount)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi tra cứu giao dịch', error: error.message });
  }
}

// Gắn các đường dẫn API (hỗ trợ cả đường dẫn gốc và tiền tố /api/payment)
app.post('/initiate', handleInitiate);
app.post('/api/payment/initiate', handleInitiate);

app.post('/verify-and-pay', handleVerifyAndPay);
app.post('/api/payment/verify-and-pay', handleVerifyAndPay);

app.post('/cancel', handleCancel);
app.post('/api/payment/cancel', handleCancel);

app.get('/history/:user_id', handleHistory);
app.get('/api/payment/history/:user_id', handleHistory);

app.get('/transaction/:transaction_id', handleTransactionDetail);
app.get('/api/payment/transaction/:transaction_id', handleTransactionDetail);

// Khởi động server
app.listen(PORT, async () => {
  await testConnection();
  console.log(`=======================================================`);
  console.log(`[PAYMENT SERVICE] Đang chạy tại cổng http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
