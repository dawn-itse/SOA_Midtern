import { Navigate, Outlet, useLocation } from 'react-router';
import { getStoredAccount } from '../lib/user';

/**
 * ProtectedRoute: Kiểm tra token xác thực người dùng.
 * - Nếu đã có token trong localStorage: cho phép truy cập route được bảo vệ.
 * - Nếu chưa có token: chuyển hướng người dùng về trang /login kèm vị trí trang trước đó.
 */
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  const location = useLocation();

  // Cần cả token lẫn user hợp lệ trong localStorage (xóa user -> về /login)
  if (!token || !getStoredAccount()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
