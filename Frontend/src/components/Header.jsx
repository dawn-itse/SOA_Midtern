import { User2, LogOut } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { formatVND } from '../lib/data';

const Header = ({user}) => {
const navigate = useNavigate();

const handleLogout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  toast.info('Đã đăng xuất tài khoản!');
  navigate('/login');
};

  return (
    <nav className="bg-blue-600 shadow-md fixed w-full top-0 left-0 z-50">
      <div className="flex justify-between px-8 h-16">
        <div className="flex items-center shrink-0">
          <Link to="/" className="text-2xl font-bold text-white hover:opacity-90 transition">
            TDTU iBanking
          </Link>
        </div>

        <div className="flex gap-4 items-center">
          <div>
            <span className="bg-white/95 px-3.5 py-1.5 rounded-2xl text-xs sm:text-sm font-semibold text-blue-700 shadow-xs">
              Số dư: {formatVND(user.balance)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-white/95 text-sm font-medium bg-blue-700/60 px-3 py-1.5 rounded-xl border border-blue-400/30">
              <User2 className="size-4 text-blue-200" />
              <span>{user.fullName || 'Sinh viên'}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-red-500/80 text-white text-xs sm:text-sm font-medium transition cursor-pointer border border-white/20 hover:border-red-400"
              title="Đăng xuất"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Header