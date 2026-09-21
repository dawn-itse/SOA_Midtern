import { User,Lock,Eye,EyeOff,ArrowRight } from 'lucide-react';
import { useState,useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { toast } from 'sonner';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation(); 
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

   // Lấy đường dẫn trang trước đó (nếu bị ProtectedRoute chuyển hướng sang login)
  const from = location.state?.from?.pathname || "/";
  useEffect(() => {
    const existingToken = localStorage.getItem('token');
    if (existingToken) {
      navigate(from, { replace: true });
    }
  }, [navigate, from]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!username || !password) {
        setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
        return;
    }

    setIsLoading(true);
    try {
      // Gọi API thật đến Auth Service (cổng 8001)
      const res = await fetch('http://localhost:8001/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim()
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Lưu vé Token và thông tin User thật từ MySQL vào localStorage
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('user', JSON.stringify(data.data.user));

        toast.success(`Đăng nhập thành công! Chào mừng ${data.data.user.full_name}`);
        navigate(from, { replace: true });
      } else {
        setError(data.message || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
      }
    } catch (err) {
      console.error('Lỗi kết nối server:', err);
      setError('Không thể kết nối đến Auth Service (Port 8001). Bạn hãy đảm bảo server đã chạy npm start nhé!');
    } finally {
      setIsLoading(false);
    }
  };  
  
  return (
    <div className="flex flex-col mx-auto max-w-96 justify-center min-h-screen">
      <form onSubmit={handleSubmit} className="space-y-5">
        <label 
          htmlFor="username" 
          className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
        >
          Tên đăng nhập / Mã số sinh viên
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <User className="size-4.5" />
          </div>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
            placeholder="Ví dụ: 520H0001"
            autoComplete="username"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition shadow-xs"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label 
              htmlFor="password" 
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              Mật khẩu
            </label>
            <button
              type="button"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
            >
              Quên mật khẩu?
            </button>
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="size-4.5" />
            </div>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              placeholder="Nhập mật khẩu của bạn"
              autoComplete="current-password"
              className="w-full pl-10 pr-11 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition shadow-xs"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
              tabIndex={-1}
              aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
            </button>
          </div>
        </div>

        {error && (
            <div className="bg-red-500/15 border border-red-500/30 text-red-500 text-[13px] p-3 rounded-xl flex items-start gap-2">
                <i className="fa-solid fa-circle-exclamation mt-0.5"></i>
                <span>{error}</span>
            </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 flex items-center justify-center gap-2 transition duration-200 active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <div className="size-4.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Đang xác thực...</span>
            </>
          ) : (
            <>
              <span>Đăng nhập iBanking</span>
              <ArrowRight className="size-4.5" />
            </>
          )}
        </button>
      </form>
    </div>
  )
}