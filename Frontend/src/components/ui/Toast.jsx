    import { useEffect, useState } from 'react';

const Toast = ({ isOpen, otpCode, email, onClose }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setVisible(true);
            const timer = setTimeout(() => {
                handleClose();
            }, 15000);
            return () => clearTimeout(timer);
        } else {
            setVisible(false);
        }
    }, [isOpen, otpCode]);

    const handleClose = () => {
        setVisible(false);
        setTimeout(onClose, 300); // Wait for transition
    };

    const handleFillOtp = () => {
        // Dispatch custom event to auto-fill OTP
        window.dispatchEvent(new CustomEvent('autofill-otp', { detail: { otp: otpCode } }));
    };

    return (
        <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-[2000] pointer-events-none">
            <div 
                className={`pointer-events-auto w-[380px] bg-slate-800 border border-brand-primary/30 rounded-xl shadow-[0_20px_25px_-5px_rgba(0,0,0,0.5)] p-4 flex items-start gap-3.5 transition-all duration-300 transform
                ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-[100px]'}`}
            >
                <div className="w-10 h-10 rounded-full bg-brand-primaryLight text-brand-primary flex items-center justify-center text-[18px] shrink-0">
                    <i className="fa-solid fa-envelope-open-text"></i>
                </div>
                <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] font-bold text-slate-100">VietBank OTP Service</span>
                        <span className="text-[11px] text-slate-400">Vừa xong</span>
                    </div>
                    <div className="text-[12px] font-semibold text-brand-gold mb-1.5">Mã OTP xác thực giao dịch</div>
                    <div className="text-[13px] text-slate-300 leading-relaxed">
                        Mã xác thực gửi đến <strong>{email}</strong>:
                        <br />
                        <span 
                            onClick={handleFillOtp}
                            title="Bấm để tự động điền mã"
                            className="inline-block bg-brand-primary/15 text-brand-primary border border-dashed border-brand-primary rounded px-2.5 py-0.5 font-heading font-extrabold text-[16px] tracking-[2px] mt-1.5 cursor-pointer hover:bg-brand-primary/25 transition-colors select-all"
                        >
                            {otpCode}
                        </span>
                    </div>
                </div>
                <button onClick={handleClose} className="text-slate-400 hover:text-slate-200 -ml-1 transition-colors">
                    <i className="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    );
};

export default Toast;
