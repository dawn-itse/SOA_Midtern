import { useState, useEffect, useRef } from 'react';
import { formatVND } from '../lib/data';
import { Card } from './ui/card';

const OtpModal = ({ isOpen, onClose, email, feeTitle, amount, activeOtp, onVerifySuccess, onResendOtp }) => {
    const [otpValues, setOtpValues] = useState(['', '', '', '', '', '']);
    const [timer, setTimer] = useState(60);
    const [errorMsg, setErrorMsg] = useState(false);
    const inputRefs = useRef([]);

    useEffect(() => {
        let interval = null;
        if (isOpen) {
            setTimer(60);
            setOtpValues(['', '', '', '', '', '']);
            setErrorMsg(false);
            if (inputRefs.current[0]) inputRefs.current[0].focus();
            
            interval = setInterval(() => {
                setTimer((prev) => (prev > 0 ? prev - 1 : 0));
            }, 1000);
        } else {
            setTimer(0);
        }
        return () => clearInterval(interval);
    }, [isOpen, activeOtp]);

    // Handle toast click to copy - we can listen for a custom event
    useEffect(() => {
        const handleAutoFill = (e) => {
            if (e.detail && e.detail.otp) {
                const chars = e.detail.otp.split('');
                setOtpValues(chars);
                setErrorMsg(false);
            }
        };
        window.addEventListener('autofill-otp', handleAutoFill);
        return () => window.removeEventListener('autofill-otp', handleAutoFill);
    }, []);

    if (!isOpen) return null;

    const handleInputChange = (idx, value) => {
        if (!/^\d*$/.test(value)) return;
        const newValues = [...otpValues];
        newValues[idx] = value;
        setOtpValues(newValues);
        setErrorMsg(false);

        if (value && idx < 5) {
            inputRefs.current[idx + 1].focus();
        }
    };

    const handleKeyDown = (idx, e) => {
        if (e.key === 'Backspace' && !otpValues[idx] && idx > 0) {
            inputRefs.current[idx - 1].focus();
        } else if (e.key === 'ArrowLeft' && idx > 0) {
            inputRefs.current[idx - 1].focus();
        } else if (e.key === 'ArrowRight' && idx < 5) {
            inputRefs.current[idx + 1].focus();
        }
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const pasteData = e.clipboardData.getData('text').trim();
        if (/^\d{6}$/.test(pasteData)) {
            setOtpValues(pasteData.split(''));
            setErrorMsg(false);
            inputRefs.current[5].focus();
        }
    };

    const handleVerify = () => {
        const entered = otpValues.join('');
        if (entered === activeOtp) {
            onVerifySuccess();
        } else {
            setErrorMsg(true);
        }
    };

    const isComplete = otpValues.join('').length === 6;
    const formatTime = (secs) => {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    return (
        <div className={`modal-overlay ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <Card className="bg-white shadow-2xl/70 flex flex-col">
                <div className="bg-white border-b border-borderGlass px-6 py-5 flex items-center gap-3.5 shrink-0">
                    <div className="w-10 h-10 rounded-full bg-brand-primaryLight text-brand-primary flex items-center justify-center text-[20px]">
                        <i className="fa-solid fa-envelope-circle-check"></i>
                    </div>
                    <h3 className="font-heading text-[18px] font-bold text-slate-700 flex-1">Xác thực OTP Email</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-[24px] leading-none transition-colors">
                        &times;
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-[14px] text-slate-400 mb-3">
                        Hệ thống đã gửi một mã OTP xác thực (6 chữ số) đến email người nộp tiền:
                    </p>
                    <div className="bg-white/5 border border-dashed border-borderGlass rounded-xl p-3 flex items-center gap-2.5 text-[14px] text-brand-primary mb-6">
                        <i className="fa-solid fa-envelope"></i>
                        <strong>{email}</strong>
                    </div>

                    {/* OTP Inputs */}
                    <div className="flex justify-between gap-2.5 mb-5">
                        {otpValues.map((val, idx) => (
                            <input
                                key={idx}
                                ref={el => inputRefs.current[idx] = el}
                                type="text"
                                maxLength={1}
                                value={val}
                                onChange={(e) => handleInputChange(idx, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(idx, e)}
                                onPaste={handlePaste}
                                className={`w-[52px] h-[60px] rounded-xl bg-slate-900/80 border-2 text-center font-heading text-[26px] font-bold outline-none transition-all
                                    ${errorMsg ? 'border-red-500 text-red-400' : 'border-borderGlass text-brand-primary focus:border-brand-primary focus:shadow-[0_0_15px_rgba(0,212,170,0.12)] focus:-translate-y-0.5'}
                                `}
                            />
                        ))}
                    </div>

                    <div className="flex items-center justify-between text-[13px] text-slate-400 mb-5">
                        <span>Mã có hiệu lực trong: <strong className="text-brand-gold">{timer > 0 ? formatTime(timer) : '00:00 (Hết hạn)'}</strong></span>
                        <button 
                            disabled={timer > 0} 
                            onClick={onResendOtp}
                            className={`font-semibold ${timer > 0 ? 'text-slate-500 cursor-not-allowed' : 'text-brand-primary cursor-pointer hover:underline'}`}
                        >
                            <i className="fa-solid fa-rotate-right"></i> Gửi lại mã OTP
                        </button>
                    </div>

                    <div className="bg-white/5 border border-borderGlass rounded-xl p-3.5 flex flex-col gap-1.5 text-[13px]">
                        <div className="flex justify-between text-slate-700">
                            <span>Khoản phí thanh toán:</span>
                            <strong>{feeTitle}</strong>
                        </div>
                        <div className="flex justify-between text-brand-primary">
                            <span>Tổng tiền:</span>
                            <strong className="text-[14px]">{formatVND(amount)}</strong>
                        </div>
                    </div>

                    {errorMsg && (
                        <div className="mt-3.5 bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg p-2.5 text-[13px] text-center">
                            <i className="fa-solid fa-circle-exclamation"></i> Mã OTP không chính xác. Vui lòng kiểm tra lại.
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-borderGlass flex justify-end gap-3 ">
                    <button onClick={onClose} className="bg-red-500 rounded-2xl text-white shadow-2xs hover:cursor-pointer py-2.5 px-5">Hủy giao dịch</button>
                    <button onClick={handleVerify} disabled={!isComplete} className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-green-500/30 hover:shadow-green-500/40 hover:cursor-pointer py-2.5 px-5 text-white">
                        <i className="fa-solid fa-shield-check"></i> Xác nhận Thanh toán
                    </button>
                </div>
            </Card>
        </div>
    );
};

export default OtpModal;
