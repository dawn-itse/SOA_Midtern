// Nhiệm vụ: Đăng nhập, Quản lý Token JWT, Số dư & Trừ tiền an toàn (Concurrency)
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import express from 'express';
import { pool, testConnection } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Auth Service] [${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl}`);
  next(); 
});

// Phải có vé token để xác nhận
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Đăng nhập
app.post('/login', async (req, res) => {
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
app.get('/profile', authenticateToken, async (req, res) => {
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

app.post('/internal/deduct',  async (req, res) => {
  const { user_id , amount, transaction_id } = req.body;
  if (!user_id || !amount || !transaction_id) {
    return res.status(400).json({success: false, message: 'Thông tin trừ tiền không hợp lệ'});
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT balance FROM users WHERE user_id = ? FOR UPDATE', [user_id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({success: false, message: 'Người dùng không tồn tại'});
    }
    const currentBalance = parseFloat(rows[0].balance);
    if (currentBalance < amount) {
      await connection.rollback();
      return res.status(400).json({success: false, message: 'Số dư không đủ'});
    }
    const newBalance = currentBalance - amount;
    await connection.query('UPDATE users SET balance = ? WHERE user_id = ?', [newBalance, user_id]);
    await connection.commit();
    res.json({success: true, message: 'Trừ tiền thành công', data: {new_balance: newBalance}});
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({success: false, message: 'Lỗi server'});
  } finally {
    connection.release();
  }
})



app.listen(PORT, async () => {
  await testConnection();
  console.log(`Auth Service is running on port ${PORT}`);
})