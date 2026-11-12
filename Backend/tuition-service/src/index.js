// Nhiệm vụ: Tra cứu sv, nợ học phí và gạch nợ học phí có điều kiện
import express from 'express';
import cors from 'cors';
import { tracing } from './tracing.js';
import { pool, testConnection } from './db.js';
import { requireAuth, requireInternalSecret } from './security.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8002;

app.use(cors());
app.use(tracing('tuition-service'));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Tuition Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next(); 
});

// API nội bộ (service gọi service) phải có header x-internal-secret
app.use('/internal', requireInternalSecret);

// 1. Tra cứu sinh viên theo MSSV (yêu cầu JWT đăng nhập)
app.get('/api/tuition/students/:student_id', requireAuth, async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp student_id' });
    }
    const Mssv = studentId.trim().toUpperCase();

    // Tìm thông tin sinh viên
    const [rows] = await pool.query('SELECT * FROM students WHERE student_id = ?', [Mssv]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }
    const student = rows[0];

    // Lấy danh sách học phí từ bảng tuition_fees
    const [feeStudent] = await pool.query('SELECT * FROM tuition_fees WHERE student_id = ? ORDER BY created_at DESC', [Mssv]);

    // Chuẩn hóa tên cột khớp với Frontend React
    const formattedFees = feeStudent.map(fee => ({
      feeId: fee.fee_id,
      price: parseFloat(fee.price),
      typeOfFee: fee.type_of_fee,
      status: fee.status,
      description: fee.description,
      createdAt: fee.created_at,
      expiredAt: fee.expired_at
    }));

    res.json({
      success: true,
      message: 'Lấy thông tin sinh viên thành công',
      data: {
        student: {
          mssv: student.student_id,
          studentName: student.student_name,
          faculty: student.faculty,
          className: student.class_name, 
          fees: formattedFees           
        }
      }
    });
  } catch (error) {
    console.error('[Tuition Service] Lỗi tra cứu:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// 2. Gạch nợ học phí an toàn (Chống Double Payment)
app.post('/internal/mark-paid', async (req, res) => {
  const { fee_id, transaction_id } = req.body;
  if (!fee_id || !transaction_id) {
    return res.status(400).json({ success: false, message: 'Thiếu mã fee_id hoặc transaction_id' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Kiểm tra học phí trong bảng tuition_fees
    const [feeRows] = await connection.query('SELECT * FROM tuition_fees WHERE fee_id = ? FOR UPDATE', [fee_id]);
    if (feeRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Không tìm thấy học phí' });
    }

    if (feeRows[0].status === 'Đã thanh toán') {
      await connection.rollback();
      return res.status(409).json({ success: false, code: 'ALREADY_PAID', message: 'Học phí này đã được thanh toán trước đó' });
    }

    // Atomic update có điều kiện
    const [result] = await connection.query(
      "UPDATE tuition_fees SET status = 'Đã thanh toán' WHERE fee_id = ? AND status = 'Chưa thanh toán'",
      [fee_id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, code: 'CONCURRENCY_CONFLICT', message: 'Xung đột: Học phí vừa được thanh toán bởi người khác' });
    }

    await connection.commit();
    return res.json({
      success: true, // Đã sửa lỗi chính tả susscess
      message: 'Gạch nợ học phí thành công',
      data: { fee_id, status: 'Đã thanh toán' }
    });

  } catch (error) {
    await connection.rollback();
    console.error('[Tuition Service] Lỗi gạch nợ:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  } finally {
    connection.release();
  }
});

// 3. Hoàn tác học phí (Bù hoàn Saga)
app.post('/internal/revert-paid', async (req, res) => {
  const { fee_id, transaction_id } = req.body; 
  try {
    await pool.query("UPDATE tuition_fees SET status = 'Chưa thanh toán' WHERE fee_id = ?", [fee_id]);
    console.log(`[Tuition Service] [SAGA ROLLBACK] Đã hoàn tác học phí ${fee_id} cho GD ${transaction_id}`);
    return res.json({ success: true, message: 'Đã hoàn tác trạng thái học phí' });
  } catch (error) {
    console.error('[Tuition Service] Lỗi hoàn tác học phí:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hoàn tác học phí' });
  }
});

// [MỚI - Đợt 1] Payment Service tra cứu 1 khoản học phí (thay cho truy vấn trực tiếp tuition_fees/students)
app.get('/internal/fees/:fee_id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.fee_id, f.student_id, s.student_name, f.price, f.type_of_fee, f.status
         FROM tuition_fees f JOIN students s ON s.student_id = f.student_id
        WHERE f.fee_id = ?`, [req.params.fee_id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, code: 'FEE_NOT_FOUND', message: 'Không tìm thấy học phí' });
    }
    const f = rows[0];
    res.json({ success: true, data: { fee_id: f.fee_id, student_id: f.student_id, student_name: f.student_name, price: parseFloat(f.price), type_of_fee: f.type_of_fee, status: f.status } });
  } catch (error) {
    console.error('[Tuition Service] Lỗi tra cứu học phí:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

app.get('/health', (req, res) => res.json({ success: true, service: 'tuition-service' }));

// 4. Khởi động server
app.listen(PORT, async () => {
  if (typeof testConnection === 'function') await testConnection();
  console.log(`[Tuition Service] Server is running on port ${PORT}`);
});