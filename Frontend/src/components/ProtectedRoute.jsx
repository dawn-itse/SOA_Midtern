import { Navigate, Outlet, useLocation } from 'react-router';

/**
 * ProtectedRoute: Kiểm tra token xác thực người dùng.
 * - Nếu đã có token trong localStorage: cho phép truy cập route được bảo vệ.
 * - Nếu chưa có token: chuyển hướng người dùng về trang /login kèm vị trí trang trước đó.
 */
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
