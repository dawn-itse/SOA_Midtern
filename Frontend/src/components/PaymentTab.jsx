import { useState } from 'react';
import { formatVND } from '../lib/data';
import { Checkbox } from './ui/checkbox';
import { Card } from './ui/card';

const PaymentTab = ({ isOpen, onClose, currentAccount, currentStudent, feeRecord, onConfirmTransaction, setDemoBalance }) => {
    const [termsAccepted, setTermsAccepted] = useState(false);

    if (!isOpen || !feeRecord) return null;

    const remainingBalance = currentAccount.balance - feeRecord.price;
    const isBalanceSufficient = remainingBalance >= 0;
    const isFeeUnpaid = feeRecord.status === 'Chưa thanh toán';
    const canConfirm = isFeeUnpaid && isBalanceSufficient && termsAccepted;

    const handleConfirm = () => {
        if (canConfirm) {
            onConfirmTransaction();
        }
    };

    return (
        <div className={`modal-overlay ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <Card className="bg-white shadow-2xl/70 flex flex-col glass-modal max-w-[1050px] w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="border-b  px-6 py-5 flex items-center gap-3.5 shrink-0">
                    <div className="w-10 h-10 rounded-full text-black flex items-center justify-center text-[20px]">
                        <i className="fa-solid fa-credit-card"></i>
                    </div>
                    <h3 className="font-heading text-[18px] font-bold text-slate-700 flex-1">Bảng Thông tin & Xác nhận Thanh toán Học phí</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-[24px] leading-none transition-colors">
                        &times;
                    </button>
                </div>

                {/* Body - 2 Columns */}
                <div className="p-6 overflow-y-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
                        {/* LEFT COLUMN: Payer & Fee Details */}
                        <div className=" flex flex-col gap-5">
                            
                            {/* Payer Info */}
                            <div className="bg-white shadow-2xl/30 border rounded-xl p-5">
                                <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-borderGlass">
                                    <span className="w-7 h-7 rounded-full bg-black text-white font-bold text-[14px] flex items-center justify-center uppercase">a</span>
                                    <h4 className="font-heading text-[15px] font-bold text-slate-700 flex-1">Thông tin Người nộp tiền (Read-only)</h4>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[13px] font-semibold text-slate-400 mb-1.5"><i className="fa-solid fa-user text-black mr-1"></i> Họ và tên người nộp:</label>
                                        <input type="text" className="form-input readonly-input" readOnly value={currentAccount.fullName} />
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-semibold text-slate-400 mb-1.5"><i className="fa-solid fa-phone text-black mr-1"></i> Số điện thoại:</label>
                                        <input type="text" className="form-input readonly-input" readOnly value={currentAccount.phone} />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[13px] font-semibold text-slate-400 mb-1.5"><i className="fa-solid fa-envelope text-black mr-1"></i> Địa chỉ Email (Nhận OTP):</label>
                                        <input type="email" className="form-input readonly-input" readOnly value={currentAccount.email} />
                                    </div>
                                </div>
                            </div>

                            {/* Selected Fee Record Info */}
                            <div className="bg-white shadow-2xl/50 border rounded-xl p-5">
                                <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-borderGlass">
                                    <span className="w-7 h-7 rounded-full bg-black text-white font-bold text-[14px] flex items-center justify-center uppercase">b</span>
                                    <h4 className="font-heading text-[15px] font-bold text-slate-700 flex-1">Chi tiết Khoản Học phí Đã chọn</h4>
                                    <span className="text-[12px] bg-brand-primaryLight text-brand-primary px-3 py-1 rounded-full border font-semibold">
                                        <i className="fa-solid fa-circle-exclamation mr-1"></i> Thanh toán 100%
                                    </span>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Mã số Sinh viên (MSSV)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{currentStudent?.mssv}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Họ và tên Sinh viên</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{currentStudent?.studentName}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Mã khoản phí (FeeID)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{feeRecord.feeId}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Mã định danh (UID)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{feeRecord.uid}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Loại học phí (TypeOfFee)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{feeRecord.typeOfFee}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Số tiền cần thanh toán</span>
                                        <span className="text-[18px] font-heading font-bold text-brand-primary">{formatVND(feeRecord.price)}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Hạn nộp (ExpiredAt)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{feeRecord.expiredAt}</span>
                                    </div>
                                    <div className="bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Ngày tạo (CreatedAt)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{feeRecord.createdAt}</span>
                                    </div>
                                    <div className="md:col-span-2 bg-white/5 border border-borderGlass rounded-lg px-3.5 py-2.5">
                                        <span className="block text-[11px] text-slate-400 uppercase font-semibold mb-0.5">Mô tả học phí (Description)</span>
                                        <span className="text-[14px] font-semibold text-slate-700">{feeRecord.description}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Payment Rules & Actions */}
                        <div className="flex flex-col gap-5">
                            <div className="bg-white shadow-2xl/30 border rounded-xl p-5 shadow-lg h-full">
                                
                                <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-borderGlass">
                                    <span className="w-7 h-7 rounded-full bg-black text-white font-bold text-[14px] flex items-center justify-center uppercase">c</span>
                                    <h4 className="font-heading text-[15px] font-bold text-slate-700 flex-1">Thanh toán & Ràng buộc</h4>
                                </div>

                                <div className="bg-white border rounded-xl p-5 mb-5">
                                    <div className="flex justify-between items-center mb-3">
                                        <span className="flex items-center gap-2 text-[14px] text-slate-400"><i className="fa-solid fa-wallet text-black"></i> Số dư khả dụng:</span>
                                        <strong className="text-[18px] font-bold text-slate-700">{formatVND(currentAccount.balance)}</strong>
                                    </div>

                                    <hr className="border-t border-borderGlass my-3" />

                                    <div className="flex justify-between items-center">
                                        <span className="flex items-center gap-2 text-[14px] text-slate-400"><i className="fa-solid fa-receipt text-black"></i> Số tiền cần đóng:</span>
                                        <strong className="text-[20px] font-heading font-bold text-brand-primary">{formatVND(feeRecord.price)}</strong>
                                    </div>

                                    {/* Diff notice */}
                                    <div className={`mt-3 p-2.5 rounded-lg text-[12px] flex items-center gap-2 ${isBalanceSufficient ? 'bg-brand-primaryLight text-black' : 'bg-red-500/15 text-red-400'}`}>
                                        {isBalanceSufficient ? (
                                            <><i className="fa-solid fa-circle-check text-brand-primary"></i> Số dư khả dụng đủ. Sau khi trừ còn: <strong>{formatVND(remainingBalance)}</strong></>
                                        ) : (
                                            <><i className="fa-solid fa-triangle-exclamation"></i> Số dư không đủ. Cần nạp thêm: <strong>{formatVND(Math.abs(remainingBalance))}</strong></>
                                        )}
                                    </div>
                                </div>

                                {/* Validation Rules */}
                                <div className="bg-white/5 border border-borderGlass rounded-xl p-4 mb-5">
                                    <h3 className="text-[13px] font-bold text-slate-400 mb-3"><i className="fa-solid fa-list-check"></i> Điều kiện thực hiện giao dịch:</h3>
                                    <ul className="flex flex-col gap-2 list-none">
                                        <li className="text-[12px] flex items-center gap-2.5 text-brand-primary">
                                            <i className="fa-solid fa-circle-check"></i> Khoản phí hợp lệ
                                        </li>
                                        <li className={`text-[12px] flex items-center gap-2.5 ${isFeeUnpaid ? 'text-brand-primary' : 'text-red-400'}`}>
                                            <i className={`fa-solid ${isFeeUnpaid ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i> 
                                            {isFeeUnpaid ? 'Khoản phí chưa thanh toán' : 'Khoản phí đã được thanh toán'}
                                        </li>
                                        <li className={`text-[12px] flex items-center gap-2.5 ${isBalanceSufficient ? 'text-brand-primary' : 'text-red-400'}`}>
                                            <i className={`fa-solid ${isBalanceSufficient ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i> Số dư khả dụng &ge; Số tiền cần đóng
                                        </li>
                                        <li className={`text-[12px] flex items-center gap-2.5 ${termsAccepted ? 'text-brand-primary' : 'text-slate-500'}`}>
                                            <i className={`fa-solid ${termsAccepted ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i> Đồng ý điều khoản dịch vụ
                                        </li>
                                    </ul>
                                </div>

                                {/* Terms Checkbox */}
                                <div className="mb-6">
                                    <label className="flex items-start space-x-1">
                                        <Checkbox className="border-indigo-300 shadow-md translate-y-[4px]"  checked={termsAccepted} onCheckedChange={(checked) => setTermsAccepted(Boolean(checked))}/>
                                        <span className="">
                                            Tôi đã đọc và đồng ý với <a href="#" className="text-brand-primary underline font-semibold">Điều khoản iBanking</a>.
                                        </span>
                                    </label>
                                </div>
                               
                                {/* Submit Button */}
                                <div>
                                    <button 
                                        disabled={!canConfirm}
                                        onClick={handleConfirm}
                                        className={`w-full btn btn-primary py-4 text-[16px] font-bold flex justify-center items-center gap-2 rounded-xl bg-green-300 ${canConfirm ? 'hover:shadow-xl/30 shadow-cyan-950 active:scale-95 rounded-xl' : ''}`}
                                    >
                                        <i className={`fa-solid ${canConfirm ? 'fa-paper-plane' : 'fa-lock'}`}></i> 
                                        {canConfirm ? 'Xác nhận giao dịch ngay' : 'Xác nhận giao dịch'}
                                    </button>
                                    
                                    {!canConfirm && (
                                        <p className="text-center text-brand-gold text-[12px] mt-2.5">
                                            <i className="fa-solid fa-triangle-exclamation"></i> Vui lòng kiểm tra điều kiện giao dịch
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default PaymentTab;
