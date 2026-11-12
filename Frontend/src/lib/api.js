// Gom MỌI lời gọi API của frontend vào đây. Từ Đợt 2: tự gắn Authorization: Bearer <token>,
// và khi nhận 401 (token thiếu/sai/hết hạn) thì xóa phiên đăng nhập và chuyển về /login.
import { toast } from 'sonner';

// Mặc định mọi lời gọi đi qua API Gateway (nginx, cổng 8000). Có thể trỏ thẳng từng service bằng VITE_AUTH_URL...
const GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8000';
export const AUTH_URL = import.meta.env.VITE_AUTH_URL || GATEWAY_URL;
export const TUITION_URL = import.meta.env.VITE_TUITION_URL || GATEWAY_URL;
export const PAYMENT_URL = import.meta.env.VITE_PAYMENT_URL || GATEWAY_URL;
export const PAYMENT_API = `${PAYMENT_URL}/api/payment`;
export const AUTH_API = `${AUTH_URL}/api/auth`;
export const TUITION_API = `${TUITION_URL}/api/tuition`;

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Gọi API. Không bao giờ ném lỗi.
 * Trả về { ok, status, data }:
 *  - ok: HTTP 2xx và body có success = true
 *  - status: mã HTTP; 0 nghĩa là lỗi mạng / timeout (không kết nối được dịch vụ)
 *  - data: body JSON ({} nếu không phải JSON)
 */
export async function request(method, url, body, headers = {}) {
  const token = localStorage.getItem('token');
  // /login không gắn token cũ (tránh coi đăng nhập sai mật khẩu là hết phiên)
  const sentToken = Boolean(token) && !headers.Authorization && !url.endsWith('/login');
  try {
    const hasBody = body !== undefined && body !== null;
    const res = await fetch(url, {
      method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(sentToken ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const data = await res.json().catch(() => ({}));
    // 401 khi ĐÃ gửi token = phiên hết hạn/không hợp lệ. (Đăng nhập sai mật khẩu cũng trả 401
    // nhưng lúc đó chưa có token nên không bị coi là hết phiên.)
    if (res.status === 401 && sentToken) handleSessionExpired();
    return { ok: res.ok && Boolean(data.success), status: res.status, data };
  } catch (err) {
    console.error(`Lỗi gọi ${method} ${url}:`, err);
    return { ok: false, status: 0, data: {} };
  }
}

let redirecting = false;
function handleSessionExpired() {
  if (redirecting) return; // nhiều request song song cùng nhận 401 chỉ xử lý một lần
  redirecting = true;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  toast.error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  setTimeout(() => { window.location.replace('/login'); }, 800);
}
