import { useState } from 'react'
import Toast from '../components/ui/Toast';
import { MOCK_STUDENTS, MOCK_ACCOUNTS } from '../lib/data';
import Header from '../components/Header'
import Content from '../components/Content';
import SearchSection from '../components/SearchSection'
import PaymentTab from '../components/PaymentTab';
import OtpModal from '../components/OtpModal';
import ReceiptModal from '../components/ReceiptModal';


const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const DashBoard = () => {
  const [currentAccount, setCurrentAccount] = useState(() => {
    const saved = localStorage.getItem('user');
    if (saved) {
      try {
        const u = JSON.parse(saved);
        return {
          id: u.user_id || "ACC001",
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
  const [activeOtp, setActiveOtp] = useState(null);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isToastOpen, setIsToastOpen] = useState(false);

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

   const handleConfirmTransaction = () => {
        // Trigger OTP Flow
        setIsPaymentModalOpen(false);
        const newOtp = generateOtp();
        setActiveOtp(newOtp);
        setIsOtpModalOpen(true);
        setIsToastOpen(true);
  };

  const handleResendOtp = () => {
        const newOtp = generateOtp();
        setActiveOtp(newOtp);
        setIsToastOpen(false); // reset toast
        setTimeout(() => setIsToastOpen(true), 100);
  };

  const handleVerifySuccess = () => {
      setIsOtpModalOpen(false);
      setIsToastOpen(false);

      // Update Backend States (mock)
      const updatedStudent = { ...currentStudent };
      const targetFee = updatedStudent.fees.find(f => f.feeId === selectedFeeRecord.feeId);
      if (targetFee) {
          targetFee.status = 'Đã thanh toán';
      }
      
      setCurrentStudent(updatedStudent);
      setCurrentAccount(prev => ({ ...prev, balance: prev.balance - selectedFeeRecord.price }));

      const finalFeeRecord = { ...selectedFeeRecord, status: 'Đã thanh toán' };
      setSelectedFeeRecord(finalFeeRecord);

      // Open Receipt
      setIsReceiptModalOpen(true);
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
        onClose={() => setIsOtpModalOpen(false)}
        email={currentAccount.email}
        feeTitle={selectedFeeRecord?.typeOfFee}
        amount={selectedFeeRecord?.price}
        activeOtp={activeOtp}
        onVerifySuccess={handleVerifySuccess}
        onResendOtp={handleResendOtp}
      />

      <ReceiptModal 
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        currentAccount={currentAccount}
        currentStudent={currentStudent}
        feeRecord={selectedFeeRecord}
      />

      <Toast 
        isOpen={isToastOpen}
        otpCode={activeOtp}
        email={currentAccount.email}
        onClose={() => setIsToastOpen(false)}
      />
    </div>
  )
}

export default DashBoard