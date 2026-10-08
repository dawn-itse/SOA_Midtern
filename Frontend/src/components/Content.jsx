import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils"
import { formatVND } from "../lib/data";
const Content = ({student,onPayClick}) => {
  return ( 
    <div>
        {!student 
            ? 
                <div className="flex flex-col gap-6 mb-6">
                    <div className="border-2 rounded-2xl bg-gray-50 shadow-md text-center py-9 px-6">
                        <GraduationCap className="mx-auto"/>
                        <h3 className="text-[18px] font-bold text-black">Vui lòng nhập Mã số Sinh viên (MSSV) ở trên để tra cứu</h3>
                        <p className="text-[14px] text-black">Bảng danh sách học phí sẽ được hiển thị ngay sau khi tra cứu thành công.</p>
                    </div>
                </div>
            :
                <div className="flex flex-col gap-6 mb-6">
                    <div className="bg-gradient-to-br to-blue-500/10 border rounded-xl p-4 md:px-6 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-brand-primary text-[#032b21] flex items-center justify-center text-[22px]">
                                <i className="fa-solid fa-user-graduate"></i>
                            </div>
                            <div>
                                <h3 className="text-[18px] font-bold text-slate-600">{student.studentName}</h3>
                                <div className="flex flex-wrap gap-3 mt-1 text-[12px] text-slate-400">
                                    <span className="bg-white/5 px-2.5 py-0.5 rounded-full">MSSV: <strong className="text-black">{student.mssv}</strong></span>
                                    <span className="bg-white/5 px-2.5 py-0.5 rounded-full">Khoa: <strong className="text-black">{student.faculty}</strong></span>
                                    <span className="bg-white/5 px-2.5 py-0.5 rounded-full">Lớp: <strong className="text-black">{student.className}</strong></span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <span className="text-[12px] px-3 py-1 rounded-full border border-brand-gold/30 font-semibold">
                                <i className="fa-solid fa-layer-group mr-1"></i> {student.fees.length} khoản phí ghi nhận
                            </span>
                        </div>
                    </div>
                </div>
        }
        {student && (
      <div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-700 text-slate-400 font-bold uppercase text-[12px]">
              <th className="w-[50px] rounded-l-2xl">STT</th>
              <th className="p-4">Nội dung / Loại Học phí</th>
              <th className="p-4">Mã phí (FeeID)</th>
              <th className="p-4">Hạn nộp</th>
              <th className="p-4">Số tiền</th>
              <th className="p-4">Trạng thái</th>
              <th className=" p-4 rounded-r-2xl">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {student.fees.map((fee, idx) => {
                const isUnpaid = fee.status === 'Chưa thanh toán';
                return (
                    <tr key={fee.feeId} className="opacity-0 animate-row-enter" style={{ animationDelay: `${idx * 150}ms` }}>
                        <td className="p-4 text-center font-bold text-slate-500">{idx + 1}</td>
                        <td className="p-4">
                            <div className="flex flex-col">
                                <strong className="text-[14px] text-slate-700">{fee.typeOfFee}</strong>
                                <small className="text-[12px] text-slate-400 mt-0.5">{fee.description}</small>
                            </div>
                        </td>
                        <td className="p-4">
                            <span className="font-mono text-[12px] bg-white/5 px-2 py-0.5 rounded text-brand-primary">{fee.feeId}</span>
                            <br />
                            <small className="text-slate-500 text-[11px] mt-1 block">{fee.uid}</small>
                        </td>
                        <td className="p-4">
                            <span className="text-brand-gold text-[13px] font-semibold">{fee.expiredAt}</span>
                        </td>
                        <td className="p-4">
                            <strong className="text-[15px] font-heading font-bold text-brand-primary">{formatVND(fee.price)}</strong>
                        </td>
                        <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold border ${isUnpaid ? 'bg-yellow-400/20 text-yellow-600 border-yellow-500/30' : 'bg-green-500/15 text-green-400 border-green-500/30'}`}>
                                <i className={`fa-solid ${isUnpaid ? 'fa-clock' : 'fa-circle-check'}`}></i> {fee.status}
                            </span>
                        </td>
                        <td className="w-[150px] p-4">
                            <button
                                onClick={() => onPayClick(fee)}
                                disabled = {!isUnpaid}
                                className={cn("px-5 py-2 rounded-xl font-body font-bold text-[13px] transition-all", 
                                isUnpaid 
                                ? 
                                "bg-green-300 text-[#032b21] shadow-[0_4px_12px_rgba(0,212,170,0.25)] hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,212,170,0.4)] cursor-pointer" 
                                : "bg-white/5 border text-slate-500 cursor-not-allowed shadow-none transform-none")}
                            >
                                {isUnpaid ? "Thanh toán" : "Đã thanh toán"}
                            </button>
                        </td>
                    </tr>
                );
            })}
          </tbody>
        </table>
      </div>
        )}
    </div>
  );
}

export default Content