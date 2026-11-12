import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// Request tracing (không thêm dependency):
// - Mỗi request có một x-request-id: nhận từ header (API Gateway đặt sẵn) hoặc tự sinh mới.
// - Trả lại ở header phản hồi x-request-id, ghi vào MỖI dòng log (JSON 1 dòng/request).
// - AsyncLocalStorage giữ requestId xuyên suốt xử lý bất đồng bộ, để payment-service truyền tiếp
//   x-request-id khi gọi auth/tuition/notification -> cùng một mã xuất hiện trong log của cả 4 service.
const als = new AsyncLocalStorage();
export const currentRequestId = () => als.getStore()?.requestId;

export function tracing(service) {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && /^[\w.-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/health') return; // healthcheck Docker gọi liên tục, không ghi log
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        service,
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10
      }));
    });
    als.run({ requestId }, next);
  };
}
