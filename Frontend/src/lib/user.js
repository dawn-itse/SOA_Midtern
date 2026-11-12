// Chuyển user (từ API / localStorage) sang dạng account dùng trong UI. KHÔNG có dữ liệu giả.
export const mapUserToAccount = (u) => ({
  id: u.id || u.user_id,
  fullName: u.full_name || u.fullName || u.username || '',
  phone: u.phone_number || u.phone || '',
  email: u.email || '',
  balance: u.balance !== undefined ? Number(u.balance) : 0,
  initials: (u.full_name || u.fullName)
    ? (u.full_name || u.fullName).split(' ').map((w) => w[0]).join('').slice(-2).toUpperCase()
    : ''
});

// Trả về account từ localStorage, hoặc null nếu chưa đăng nhập / dữ liệu hỏng
export const getStoredAccount = () => {
  try {
    const saved = localStorage.getItem('user');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!parsed || !(parsed.id || parsed.user_id)) return null;
    return mapUserToAccount(parsed);
  } catch {
    return null;
  }
};
