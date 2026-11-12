// Nhiệm vụ: Đăng nhập, Quản lý Token JWT, Số dư & Trừ tiền an toàn (Concurrency)
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import express from 'express';
import { tracing } from './tracing.js';
import { pool, testConnection } from './db.js';
import { requireInternalSecret } from './security.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(tracing('auth-service'));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Auth Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next(); 
});

// Phải có vé token (JWT) để xác nhận. Thiếu/sai/hết hạn -> 401 UNAUTHORIZED (JSON, frontend dựa vào 401 để đăng xuất)
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({success: false, code: 'UNAUTHORIZED', message: 'Thiếu token đăng nhập'});
  }
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      return res.status(401).json({success: false, code: 'UNAUTHORIZED', message: 'Token không hợp lệ hoặc đã hết hạn'});
    }
    req.user = user;
    next();
  });
}

// API nội bộ (service gọi service) phải có header x-internal-secret
app.use('/internal', requireInternalSecret);

// Đăng nhập (URI chuẩn hóa ở Đợt 2: /api/auth/login)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({success: false, message: 'Vui lòng nhập đầy đủ username và password'});
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (rows.length === 0) {
      return res.status(401).json({success: false, message: 'Sai username hoặc password'});
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({success: false, message: 'Sai username hoặc password'});
    }
    const token = jwt.sign({id: user.user_id, username: user.username, full_name: user.full_name, email: user.email,}, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.json({success: true, message: 'Đăng nhập thành công', data: {
      token,
      user: {
        id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        phone_number: user.phone_number,
        email: user.email,
        balance: parseFloat(user.balance),
      }
    }});
  } catch (err) {
    console.error(err);
    res.status(500).json({success: false, message: 'Lỗi server'});
  }
});

// Lấy thông tin người dùng từ token
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({success: false, message: 'Người dùng không tồn tại'});
    }
    const user = rows[0];
    res.json({success: true, data: {
      id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      phone_number: user.phone_number,
      email: user.email,
      balance: parseFloat(user.balance),
    }});
  } catch (err) {
    console.error(err);
    res.status(500).json({success: false, message: 'Lỗi server'});
  } finally {
    // Không cần release connection ở đây vì pool.query tự động quản lý connection
  }
});

app.post('/internal/deduct', async (req, res) => {
  const { user_id , amount, transaction_id } = req.body;
  const amt = Number(amount);
  if (!user_id || !transaction_id || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({success: false, message: 'Thông tin trừ tiền không hợp lệ'});
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Khóa dòng; so sánh số dư ngay trong SQL (DECIMAL), không dùng số thực JS
    const [rows] = await connection.query('SELECT balance, balance >= ? AS enough FROM users WHERE user_id = ? FOR UPDATE', [amt, user_id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({success: false, message: 'Người dùng không tồn tại'});
    }
    if (!Number(rows[0].enough)) {
      await connection.rollback();
      return res.status(400).json({success: false, message: 'Số dư không đủ'});
    }
    await connection.query('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amt, user_id]);
    // Đọc lại số dư sau UPDATE (cùng transaction, vẫn giữ khóa dòng) để trả new_balance chính xác
    const [after] = await connection.query('SELECT balance FROM users WHERE user_id = ?', [user_id]);
    await connection.commit();
    res.json({success: true, message: 'Trừ tiền thành công', data: {new_balance: parseFloat(after[0].balance)}});
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({success: false, message: 'Lỗi server'});
  } finally {
    connection.release();
  }
})



// [MỚI - Đợt 1] Payment Service tra cứu user (thay cho truy vấn trực tiếp bảng users)
app.get('/internal/users/:user_id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT user_id, full_name, email, balance FROM users WHERE user_id = ?', [req.params.user_id]);
    if (rows.length === 0) {
      return res.status(404).json({success: false, code: 'USER_NOT_FOUND', message: 'Người dùng không tồn tại'});
    }
    const u = rows[0];
    res.json({success: true, data: {user_id: u.user_id, full_name: u.full_name, email: u.email, balance: parseFloat(u.balance)}});
  } catch (err) {
    console.error(err);
    res.status(500).json({success: false, message: 'Lỗi server'});
  }
});

app.get('/health', (req, res) => res.json({success: true, service: 'auth-service'}));

app.listen(PORT, async () => {
  await testConnection();
  console.log(`Auth Service is running on port ${PORT}`);
})