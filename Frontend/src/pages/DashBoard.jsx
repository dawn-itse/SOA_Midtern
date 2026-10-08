import { useState } from 'react'
import { toast } from 'sonner';
import { MOCK_STUDENTS, MOCK_ACCOUNTS } from '../lib/data';
import Header from '../components/Header'
import Content from '../components/Content';
import SearchSection from '../components/SearchSection'
import PaymentTab from '../components/PaymentTab';
import OtpModal from '../components/OtpModal';
import ReceiptModal from '../components/ReceiptModal';


const PAYMENT_API = 'http://localhost:8003/api/payment';

const postJson = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.success, data };
};

const DashBoard = () => {
  const [currentAccount, setCurrentAccount] = useState(() => {
    const saved = localStorage.getItem('user');
    if (saved) {
      try {
        const u = JSON.parse(saved);
        return {
          id: u.id || u.user_id || "ACC001",
          fullName: u.full_name || u.username || "Nguyễn Văn A",
          phone: u.phone_number || "0912 345 678",
          email: u.email || "nguyenvana.banking@gmail.com",
          balance: u.balance !== undefined ? u.balance : 15000000,
          initials: u.full_name ? u.full_name.split(' ').map(w => w[0]).join('').slice(-2).toUpperCase() : "NV"
        };
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
              // Giao dịch đã FAILED, phải bắt đầu lại; làm mới danh sách học phí (có thể đã bị người khác đóng)
              setIsOtpModalOpen(false);
              setTransactionId(null);
              toast.error(data.message || 'Thanh toán thất bại');
              handleSearch(currentStudent?.mssv);
              return { ok: false, closed: true };
          }
          return { ok: false, message: data.message };
      }

      const r = data.data;
      setIsOtpModalOpen(false);
      setReceipt(r);
      setCurrentStudent(prev => ({ ...prev, fees: prev.fees.map(f => f.feeId === r.feeId ? { ...f, status: 'Đã thanh toán' } : f) }));
      setCurrentAccount(prev => ({ ...prev, balance: r.newBalance ?? prev.balance - r.amount }));
      setSelectedFeeRecord(prev => ({ ...prev, status: 'Đã thanh toán' }));
      setIsReceiptModalOpen(true);
      return { ok: true };
  };

  const handleCancelTransaction = async () => {
      setIsOtpModalOpen(false);
      if (transactionId) {
          await postJson(`${PAYMENT_API}/cancel`, { transaction_id: transactionId });
          setTransactionId(null);
      }
  };

  const setDemoBalance = (amount) => {
        setCurrentAccount(prev => ({ ...prev, balance: amount }));
    };
  
  return (
    <div className='flex flex-col min-h-screen'>
      <Header 
       user={currentAccount}
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
        setDemoBalance={setDemoBalance}
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

    </div>
  )
}

export default DashBoard