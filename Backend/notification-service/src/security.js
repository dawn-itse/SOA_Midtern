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
