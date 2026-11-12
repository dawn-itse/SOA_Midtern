import crypto from 'crypto';

// Xác thực service-to-service: header x-internal-secret phải khớp INTERNAL_API_SECRET.
// So sánh bằng hash + timingSafeEqual để không lộ độ dài / nội dung secret qua thời gian phản hồi.
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function requireInternalSecret(req, res, next) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    console.error('[Security] Chưa cấu hình INTERNAL_API_SECRET -> từ chối mọi request nội bộ');
    return res.status(500).json({ success: false, code: 'SERVER_MISCONFIGURED', message: 'Dịch vụ chưa được cấu hình bí mật nội bộ' });
  }
  const given = req.headers['x-internal-secret'];
  if (typeof given !== 'string' || !crypto.timingSafeEqual(digest(given), digest(expected))) {
    return res.status(401).json({ success: false, code: 'INVALID_INTERNAL_SECRET', message: 'Thiếu hoặc sai x-internal-secret' });
  }
  next();
}

// Xác thực JWT HS256 bằng module crypto có sẵn của Node (không thêm dependency mới,
// nên package-lock.json hiện có vẫn hợp lệ cho `npm ci` trong Dockerfile).
// Trả về payload nếu token hợp lệ và chưa hết hạn, ngược lại trả về null.
export function verifyJwt(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null; // chặn alg=none và đổi thuật toán
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const given = Buffer.from(s, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Middleware: bắt buộc "Authorization: Bearer <JWT>". Thành công -> req.user = payload (có id, username...).
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[Security] Chưa cấu hình JWT_SECRET');
    return res.status(500).json({ success: false, code: 'SERVER_MISCONFIGURED', message: 'Dịch vụ chưa được cấu hình JWT_SECRET' });
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
  const payload = m ? verifyJwt(m[1], secret) : null;
  if (!payload || !payload.id) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Thiếu hoặc sai token đăng nhập, hoặc token đã hết hạn' });
  }
  req.user = payload;
  next();
}
