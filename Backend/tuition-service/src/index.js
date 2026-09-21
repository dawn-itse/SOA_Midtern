import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Tuition Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next(); 
});

// Tra cứu sinh viên 
app.get('/lookup/:student_id', async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp student_id' });
    }
    const Mssv = studentId.trim().toUpperCase();
    const [rows] = await pool.query('SELECT * FROM students WHERE student_id = ?', [Mssv]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }
    const student = rows[0];
    const [feeStudent] = await pool.query('SELECT * FROM fee_student WHERE student_id = ?', [Mssv]);
    res.json({ success: true, message: 'Lấy thông tin sinh viên thành công', data: { student: {mssv: student.student_id, studentName: student.student_name, faculty: student.faculty, className: student.class, fees: feeStudent}}});
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
})


// Gạch nợ học phí
app.post('/internal/mark-paid', async (req, res) => {
  const { fee_id, transaction_id } = req.body;
  if (!fee_id || !transaction_id) {
    return res.status(400).json({ success: false, message: 'Thiếu mã fee_id và transaction_id' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [feeRows] = await connection.query('SELECT * FROM fee_student WHERE fee_id = ?', [fee_id]);
    if (feeRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Không tìm thấy học phí' });
    }
    if(feeRows[0].status === 'PAID') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Học phí đã được thanh toán' });
    }
    const [result] = await connection.query("UPDATE tuition_fees SET status = 'Đã thanh toán' WHERE fee_id = ? AND status = 'Chưa thanh toán'", [fee_id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(500).json({ success: false, message: 'Cập nhật trạng thái học phí thất bại' });
    }
    await connection.commit(); // Gạch nợ thành công
    return res.json({
      susscess: true,
      message: 'Gạch nợ học phí thành công',
      data: { fee_id, status: 'Đã thanh toán'}
    })
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  } finally {
    connection.release();
  }
})

app.listen(PORT, () => {
  console.log(`[Tuition Service] Server is running on port ${PORT}`);
});