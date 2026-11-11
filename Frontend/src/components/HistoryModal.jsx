import { useState } from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, Ban, Clock, FileText, X } from 'lucide-react';
import { formatVND } from '../lib/data';
import { Card } from './ui/card';

const STATUS_META = {
  COMPLETED: {
    label: 'Thành công',
    badgeClass: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    Icon: CheckCircle2
  },
  FAILED: {
    label: 'Thất bại',
    badgeClass: 'bg-red-500/15 text-red-600 border-red-500/30',
    Icon: XCircle
  },
  CANCELLED: {
    label: 'Đã hủy',
    badgeClass: 'bg-slate-500/15 text-slate-600 border-slate-400/30',
    Icon: Ban
  },
  PENDING_OTP: {
    label: 'Chờ OTP',
    badgeClass: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    Icon: Clock
  },
  PROCESSING: {
    label: 'Đang xử lý',
    badgeClass: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    Icon: Clock
  }
};

const FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'COMPLETED', label: 'Thành công' },
  { key: 'FAILED', label: 'Thất bại' },
  { key: 'CANCELLED', label: 'Đã hủy' }
];

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN');
};

const HistoryModal = ({ isOpen, onClose, transactions = [], isLoading, onRefresh, onViewReceipt }) => {
  const [filter, setFilter] = useState('ALL');

  if (!isOpen) return null;

  const filteredList = filter === 'ALL'
    ? transactions
    : transactions.filter((t) => t.status === filter);

  return (
    <div className="modal-overlay">
      <Card className="bg-white shadow-2xl/70 flex flex-col max-w-[1050px] w-full max-h-[88vh] rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between gap-3 shrink-0 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600/10 text-blue-600 flex items-center justify-center">
              <History className="size-5" />
            </div>
            <div>
              <h3 className="font-heading text-[18px] font-bold text-slate-800">
                Lịch sử Giao dịch Thanh toán Học phí
              </h3>
              <p className="text-[12px] text-slate-500">
                Tổng cộng {transactions.length} giao dịch được ghi nhận trên hệ thống
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
              aria-label="Đóng"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-6 py-3 border-b bg-white flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count = f.key === 'ALL'
                ? transactions.length
                : transactions.filter((t) => t.status === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              Đang tải lịch sử giao dịch từ Payment Service...
            </div>
          ) : filteredList.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <History className="size-10 mx-auto mb-2 text-slate-300" />
              <p className="font-semibold text-slate-700">Chưa có giao dịch nào</p>
              <p className="text-xs text-slate-400 mt-1">
                Các giao dịch thanh toán học phí của bạn sẽ được lưu trữ tại đây.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-slate-800 text-slate-200 font-bold uppercase text-[11px]">
                    <th className="p-3.5 rounded-l-xl">Mã GD / Thời gian</th>
                    <th className="p-3.5">Sinh viên</th>
                    <th className="p-3.5">Khoản học phí</th>
                    <th className="p-3.5">Số tiền</th>
                    <th className="p-3.5">Trạng thái / Chi tiết</th>
                    <th className="p-3.5 rounded-r-xl text-center">Biên lai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[13px]">
                  {filteredList.map((item) => {
                    const meta = STATUS_META[item.status] || {
                      label: item.status,
                      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
                      Icon: Clock
                    };
                    const StatusIcon = meta.Icon;

                    return (
                      <tr key={item.transactionId} className="hover:bg-slate-50/80 transition">
                        <td className="p-3.5 align-top">
                          <span className="font-mono text-[12px] font-bold text-slate-800 block">
                            {item.transactionId}
                          </span>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            Tạo: {formatDateTime(item.createdAt)}
                          </span>
                          {item.completedAt && (
                            <span className="text-[11px] text-emerald-600 block">
                              Hoàn tất: {formatDateTime(item.completedAt)}
                            </span>
                          )}
                        </td>

                        <td className="p-3.5 align-top">
                          <strong className="text-slate-800 block">
                            {item.studentName || '—'}
                          </strong>
                          <span className="text-[11px] text-slate-500 font-mono">
                            MSSV: {item.studentId}
                          </span>
                        </td>

                        <td className="p-3.5 align-top">
                          <strong className="text-slate-700 block">
                            {item.typeOfFee || item.feeId}
                          </strong>
                          <span className="text-[11px] text-slate-500 font-mono block">
                            {item.feeId}
                          </span>
                        </td>

                        <td className="p-3.5 align-top font-heading font-bold text-slate-800 whitespace-nowrap">
                          {formatVND(item.amount)}
                        </td>

                        <td className="p-3.5 align-top">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${meta.badgeClass}`}
                          >
                            <StatusIcon className="size-3.5" />
                            {meta.label}
                          </span>
                          {item.failureReason && (
                            <p className="text-[11px] text-red-500 mt-1 max-w-[260px]">
                              Lý do: {item.failureReason}
                            </p>
                          )}
                        </td>

                        <td className="p-3.5 align-top text-center">
                          {item.status === 'COMPLETED' ? (
                            <button
                              type="button"
                              onClick={() => onViewReceipt(item)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold transition cursor-pointer"
                            >
                              <FileText className="size-3.5" />
                              <span>Xem</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default HistoryModal;
