/* eslint-disable react-hooks/preserve-manual-memoization */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { request, AUTH_API, TUITION_API, PAYMENT_API } from '../lib/api';
import { mapUserToAccount, getStoredAccount } from '../lib/user';
import Header from '../components/Header'
import Content from '../components/Content';
import SearchSection from '../components/SearchSection'
import PaymentTab from '../components/PaymentTab';
import OtpModal from '../components/OtpModal';
import ReceiptModal from '../components/ReceiptModal';

const postJson = (url, body, headers) => request('POST', url, body, headers);

const syncUserBalanceToStorage = (newBalance) => {
  try {
    const saved = localStorage.getItem('user');
    if (saved) {
      const parsed = JSON.parse(saved);
      localStorage.setItem('user', JSON.stringify({ ...parsed, balance: newBalance }));
    }
  } catch (e) { /* bỏ qua */ }
};

const DashBoard = () => {
  const idemKeyRef = useRef(null); // Idempotency-Key của lần khởi tạo thanh toán đang thực hiện
  const navigate = useNavigate();
  // Không có user hợp lệ trong localStorage -> null (bị chuyển về /login), không tự cấp tài khoản giả
  const [currentAccount, setCurrentAccount] = useState(() => getStoredAccount());
  const [currentStudent, setCurrentStudent] = useState(null);
  const [selectedFeeRecord, setSelectedFeeRecord] = useState(null);
  const [transactionId, setTransactionId] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  // Đồng bộ thông tin tài khoản & số dư mới nhất từ Auth Service (GET /profile)
  const fetchProfile = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const { ok, status, data } = await request('GET', `${AUTH_API}/profile`);
    // 401: request() đã xóa phiên, báo lỗi và chuyển về /login
    if (status === 401) return;
    if (ok && data.data) {
      setCurrentAccount(mapUserToAccount(data.data));
      localStorage.setItem('user', JSON.stringify(data.data));
    }
    // status 0 (không kết nối được Auth Service): giữ số dư đang có, không báo lỗi gây phiền
  }, [navigate]);

  useEffect(() => {
    if (!currentAccount) navigate('/login', { replace: true });
  }, [currentAccount, navigate]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSearch = async (mssv) => {
    if (!mssv || !mssv.trim()) {
      setCurrentStudent(null);
      return;
    }

    // Gọi API thật sang Tuition Service. Không có dữ liệu dự phòng/giả.
    const { ok, status, data } = await request('GET', `${TUITION_API}/students/${encodeURIComponent(mssv.trim())}`);
    if (ok && data.data?.student) {
      setCurrentStudent(data.data.student);
      return;
    }
    setCurrentStudent(null);
    if (status === 0 || status >= 500) {
      toast.error('Không kết nối được dịch vụ học phí, vui lòng thử lại');
    } else {
      toast.error(data.message || 'Không tìm thấy sinh viên');
    }
  };

  const handlePayClick = (feeRecord) => {
      setSelectedFeeRecord(feeRecord);
      setIsPaymentModalOpen(true);
  };

   const handleConfirmTransaction = async () => {
        // Gọi Payment Service: kiểm tra số dư/học phí, tạo giao dịch, gửi OTP qua email
        // Idempotency-Key: bấm 2 lần hoặc retry khi mất mạng thì server trả lại cùng một giao dịch, không tạo giao dịch trùng.
        // Key chỉ được bỏ đi khi server đã trả lời (thành công hoặc lỗi nghiệp vụ); lỗi mạng (status 0) giữ key để retry.
        if (!idemKeyRef.current) idemKeyRef.current = crypto.randomUUID();
        const { ok, status, data } = await postJson(`${PAYMENT_API}/initiate`, {
            fee_id: selectedFeeRecord.feeId,
            student_id: currentStudent.mssv,
            amount: selectedFeeRecord.price
        }, { 'Idempotency-Key': idemKeyRef.current });
        if (status !== 0) idemKeyRef.current = null;
        if (!ok) {
            toast.error(data.message || 'Không thể khởi tạo giao dịch');
            return;
        }
        setTransactionId(data.transaction_id);
        setIsPaymentModalOpen(false);
        setIsOtpModalOpen(true);
        toast.success('Mã OTP đã được gửi tới email đăng ký của bạn');
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

  if (!currentAccount) return null; // đang chuyển về /login

  return (
    <div className='flex flex-col min-h-screen'>
      <Header user={currentAccount} />
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

    </div>
  )
}

export default DashBoard