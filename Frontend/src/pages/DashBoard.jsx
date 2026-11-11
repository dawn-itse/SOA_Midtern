/* eslint-disable react-hooks/preserve-manual-memoization */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { MOCK_STUDENTS, MOCK_ACCOUNTS } from '../lib/data';
import Header from '../components/Header'
import Content from '../components/Content';
import SearchSection from '../components/SearchSection'
import PaymentTab from '../components/PaymentTab';
import OtpModal from '../components/OtpModal';
import ReceiptModal from '../components/ReceiptModal';
import HistoryModal from '../components/HistoryModal';


const AUTH_API = 'http://localhost:8001';
const PAYMENT_API = 'http://localhost:8003/api/payment';

const postJson = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.success, data };
};

const mapUserToAccount = (u) => ({
  id: u.id || u.user_id || "ACC001",
  fullName: u.full_name || u.fullName || u.username || "Nguyễn Văn A",
  phone: u.phone_number || u.phone || "0912 345 678",
  email: u.email || "nguyenvana.banking@gmail.com",
  balance: u.balance !== undefined ? Number(u.balance) : 15000000,
  initials: (u.full_name || u.fullName)
    ? (u.full_name || u.fullName).split(' ').map(w => w[0]).join('').slice(-2).toUpperCase()
    : "NV"
});

const syncUserBalanceToStorage = (newBalance) => {
  try {
    const saved = localStorage.getItem('user');
    if (saved) {
      const parsed = JSON.parse(saved);
      localStorage.setItem('user', JSON.stringify({ ...parsed, balance: newBalance }));
    }
  } catch (e) {}
};

const DashBoard = () => {
  const navigate = useNavigate();
  const [currentAccount, setCurrentAccount] = useState(() => {
    const saved = localStorage.getItem('user');
    if (saved) {
      try {
        return mapUserToAccount(JSON.parse(saved));
      } catch (e) {}
    }
    return MOCK_ACCOUNTS["ACC001"];
  });
  const [currentStudent, setCurrentStudent] = useState(null);
  const [selectedFeeRecord, setSelectedFeeRecord] = useState(null);
  const [transactionId, setTransactionId] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Tải lịch sử giao dịch từ Payment Service (GET /api/payment/history/:user_id)
  const fetchHistory = useCallback(async () => {
    if (!currentAccount?.id) return;
    setIsHistoryLoading(true);
    try {
      const res = await fetch(`${PAYMENT_API}/history/${currentAccount.id}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && Array.isArray(data.data)) {
        setHistoryList(data.data);
      } else {
        toast.error(data.message || 'Không thể tải lịch sử giao dịch');
      }
    } catch (err) {
      console.error('Lỗi tải lịch sử giao dịch:', err);
      toast.error('Không thể kết nối đến Payment Service (Port 8003)');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [currentAccount?.id]);

  const handleOpenHistory = () => {
    setIsHistoryModalOpen(true);
    fetchHistory();
  };

  const handleViewReceiptFromHistory = (item) => {
    setReceipt({
      transactionId: item.transactionId,
      completedAt: item.completedAt || item.createdAt,
      amount: item.amount,
      feeId: item.feeId,
      typeOfFee: item.typeOfFee,
      studentId: item.studentId,
      studentName: item.studentName
    });
    setIsHistoryModalOpen(false);
    setIsReceiptModalOpen(true);
  };

  // Đồng bộ thông tin tài khoản & số dư mới nhất từ Auth Service (GET /profile)
  const fetchProfile = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${AUTH_API}/profile`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        toast.error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
        navigate('/login', { replace: true });
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.data) {
        setCurrentAccount(mapUserToAccount(data.data));
        localStorage.setItem('user', JSON.stringify(data.data));
      }
    } catch (err) {
      console.warn('Không thể kết nối Auth Service để đồng bộ profile, giữ dữ liệu localStorage:', err);
    }
  }, [navigate]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSearch = async (mssv) => {
    if (!mssv || !mssv.trim()) {
      setCurrentStudent(null);
      return;
    }

    try {
      // Gọi API thật sang Tuition Service (cổng 8002)
      const res = await fetch(`http://localhost:8002/lookup/${mssv.trim()}`);
      const data = await res.json();

      if (res.ok && data.success) {
        // Cập nhật thông tin sinh viên và học phí lấy trực tiếp từ CSDL MySQL
        setCurrentStudent(data.data.student);
      } else {
        setCurrentStudent(null);
      }
    } catch (err) {
      console.error('Lỗi tra cứu từ Tuition Service:', err);
      // Fallback dự phòng đọc từ mock data nếu cổng 8002 chưa được bật
      const fallback = MOCK_STUDENTS[mssv.trim().toUpperCase()];
      if (fallback) {
        setCurrentStudent(JSON.parse(JSON.stringify(fallback)));
      } else {
        setCurrentStudent(null);
      }
    }
  };

  const handlePayClick = (feeRecord) => {
      setSelectedFeeRecord(feeRecord);
      setIsPaymentModalOpen(true);
  };

   const handleConfirmTransaction = async () => {
        // Gọi Payment Service: kiểm tra số dư/học phí, tạo giao dịch, gửi OTP qua email
        const { ok, data } = await postJson(`${PAYMENT_API}/initiate`, {
            user_id: currentAccount.id,
            fee_id: selectedFeeRecord.feeId,
            student_id: currentStudent.mssv,
            amount: selectedFeeRecord.price
        });
        if (!ok) {
            toast.error(data.message || 'Không thể khởi tạo giao dịch');
            return;
        }
        setTransactionId(data.transaction_id);
        setIsPaymentModalOpen(false);
        setIsOtpModalOpen(true);
        toast.success(`Đã gửi mã OTP tới ${data.email}`);
  };

  const handleResendOtp = async () => {
        const { ok, data } = await postJson(`${PAYMENT_API}/resend-otp`, { transaction_id: transactionId });
        if (ok) toast.success('Đã gửi lại mã OTP');
        else toast.error(data.message || 'Không thể gửi lại OTP');
  };

  // Trả về { ok, message } để OtpModal hiển thị lỗi thật từ server (OTP sai / hết hạn...)
  const handleVerifyOtp = async (otpCode) => {
      const { ok, data } = await postJson(`${PAYMENT_API}/verify-and-pay`, { transaction_id: transactionId, otp_code: otpCode });
      if (!ok) {
          if (data.transaction_status === 'FAILED') {
              // Giao dịch đã FAILED, phải bắt đầu lại; làm mới danh sách học phí & số dư
              setIsOtpModalOpen(false);
              setTransactionId(null);
              toast.error(data.message || 'Thanh toán thất bại');
              handleSearch(currentStudent?.mssv);
              fetchProfile();
              return { ok: false, closed: true };
          }
          return { ok: false, message: data.message };
      }

      const r = data.data;
      setIsOtpModalOpen(false);
      setReceipt(r);
      setCurrentStudent(prev => ({ ...prev, fees: prev.fees.map(f => f.feeId === r.feeId ? { ...f, status: 'Đã thanh toán' } : f) }));
      setCurrentAccount(prev => {
          const updatedBalance = r.newBalance ?? (prev.balance - r.amount);
          syncUserBalanceToStorage(updatedBalance);
          return { ...prev, balance: updatedBalance };
      });
      setSelectedFeeRecord(prev => ({ ...prev, status: 'Đã thanh toán' }));
      setIsReceiptModalOpen(true);
      fetchProfile();
      return { ok: true };
  };

  const handleCancelTransaction = async () => {
      setIsOtpModalOpen(false);
      if (transactionId) {
          await postJson(`${PAYMENT_API}/cancel`, { transaction_id: transactionId });
          setTransactionId(null);
      }
  };

  
  return (
    <div className='flex flex-col min-h-screen'>
      <Header 
       user={currentAccount}
       onOpenHistory={handleOpenHistory}
      />
      <div className='mx-auto w-[1000px] space-y-6 pt-28'>
        <SearchSection onSearch={handleSearch}/>
        <Content student={currentStudent} onPayClick={handlePayClick}/>
      </div>

      <PaymentTab
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        currentAccount={currentAccount}
        currentStudent={currentStudent}
        feeRecord={selectedFeeRecord}
        onConfirmTransaction={handleConfirmTransaction}
      />

      <OtpModal
        isOpen={isOtpModalOpen}
        onClose={handleCancelTransaction}
        email={currentAccount.email}
        feeTitle={selectedFeeRecord?.typeOfFee}
        amount={selectedFeeRecord?.price}
        onVerify={handleVerifyOtp}
        onResendOtp={handleResendOtp}
      />

      <ReceiptModal 
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        currentAccount={currentAccount}
        currentStudent={currentStudent}
        feeRecord={selectedFeeRecord}
        receipt={receipt}
      />

      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        transactions={historyList}
        isLoading={isHistoryLoading}
        onRefresh={fetchHistory}
        onViewReceipt={handleViewReceiptFromHistory}
      />

    </div>
  )
}

export default DashBoard