import { formatVND } from '../lib/data';

const ReceiptModal = ({ isOpen, onClose, currentAccount, currentStudent, feeRecord, receipt }) => {
    if (!isOpen || !feeRecord || !currentStudent) return null;

    const handlePrint = () => {
        window.print();
    };

    const txnId = receipt?.transactionId || ('TXN-' + Math.floor(1000000000 + Math.random() * 9000000000));
    const now = receipt?.completedAt ? new Date(receipt.completedAt) : new Date();
    const timeStr = now.toLocaleDateString('vi-VN') + ' ' + now.toLocaleTimeString('vi-VN');

    return (
        <div className={`modal-overlay ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="glass-modal flex flex-col relative bg-white text-slate-800" id="receipt-printable-area">
                
                {/* Stamp */}
                <div className="absolute top-[80px] right-[40px] text-[32px] font-black text-emerald-500/15 border-4 border-emerald-500/20 px-4 py-1 rounded-lg -rotate-12 tracking-widest pointer-events-none z-10">
                    PAID
                </div>

                <div className="text-center pt-8 pb-4 px-6">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-primary to-emerald-500 text-white flex items-center justify-center text-[36px] mx-auto mb-3 shadow-[0_0_25px_rgba(0,212,170,0.4)]">
                        <i className="fa-solid fa-circle-check"></i>
                    </div>
                    <h2 className="font-heading text-[24px] font-bold text-slate-900">Giao dịch Thành Công!</h2>
                    <p className="text-[13px] text-slate-500 mt-1">Biên nhận Thanh toán Học phí Trực tuyến</p>
                </div>

                <div className="px-8 pb-6 relative z-20">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center mb-5">
                        <span className="text-[12px] text-slate-500 uppercase tracking-wide font-semibold block mb-1">Tổng tiền đã thanh toán</span>
                        <h1 className="font-heading text-[28px] font-extrabold text-emerald-600">{formatVND(feeRecord.price)}</h1>
                    </div>

                    <div className="flex flex-col gap-2.5 text-[13px]">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Mã giao dịch (TxnID):</span>
                            <strong className="text-slate-700">{txnId}</strong>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Thời gian giao dịch:</span>
                            <strong className="text-slate-700">{timeStr}</strong>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Người nộp tiền:</span>
                            <strong className="text-slate-700">{currentAccount.fullName}</strong>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Email thông báo:</span>
                            <strong className="text-slate-700">{currentAccount.email}</strong>
                        </div>
                        
                        <hr className="border-t border-dashed border-slate-300 my-2" />
                        
                        <div className="flex justify-between">
                            <span className="text-slate-500">Họ & Tên Sinh viên:</span>
                            <strong className="text-slate-700">{currentStudent.studentName}</strong>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Mã số Sinh viên:</span>
                            <strong className="text-slate-700">{currentStudent.mssv}</strong>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Mã khoản phí (FeeID):</span>
                            <strong className="text-slate-700">{feeRecord.feeId}</strong>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Loại học phí:</span>
                            <strong className="text-slate-700">{feeRecord.typeOfFee}</strong>
                        </div>
                        <div className="flex justify-between mt-1">
                            <span className="text-slate-500">Số dư còn lại:</span>
                            <strong className="text-amber-600 text-[14px]">{formatVND(currentAccount.balance)}</strong>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-between gap-3 rounded-b-2xl print:hidden">
                    <button onClick={handlePrint} className="btn py-2.5 px-5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold shadow-sm">
                        <i className="fa-solid fa-print"></i> In Biên nhận
                    </button>
                    <button onClick={onClose} className="btn py-2.5 px-5 bg-slate-800 text-white hover:bg-slate-900 font-semibold shadow-md">
                        <i className="fa-solid fa-house"></i> Hoàn thành & Trở về
                    </button>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{__html: `
                @media print {
                    body * { visibility: hidden; }
                    #receipt-printable-area, #receipt-printable-area * { visibility: visible; }
                    #receipt-printable-area { position: absolute; left: 0; top: 0; width: 100%; border: none; box-shadow: none; }
                }
            `}} />
        </div>
    );
};

export default ReceiptModal;
