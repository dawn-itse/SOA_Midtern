// Gửi thử 1 mail biên lai tới email chỉ định.   Chạy: npm run test:mail -- <email>
import dotenv from 'dotenv';
import { sendMail, getMailMode, getMailOverride } from '../src/mailer.js';

dotenv.config();

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('Cách dùng: npm run test:mail -- <email nhận>');
  process.exit(1);
}

console.log(`Chế độ gửi mail: ${getMailMode()}${getMailOverride() ? ` (MAIL_TO_OVERRIDE=${getMailOverride()})` : ''}`);
try {
  const r = await sendMail({
    to,
    subject: '[TDTU iBanking] Thư thử - biên lai mẫu',
    text: 'BIÊN LAI THANH TOÁN HỌC PHÍ (THƯ THỬ)\n\nMã giao dịch: TXN-TEST\nSố tiền: 1.000.000 VND\n\nNếu bạn nhận được thư này, cấu hình mail đã hoạt động.',
    html: '<h2>Biên lai thanh toán (thư thử)</h2><p>Mã giao dịch: <b>TXN-TEST</b></p><p>Số tiền: <b>1.000.000 VND</b></p><p>Nếu bạn nhận được thư này, cấu hình mail đã hoạt động.</p>'
  });
  console.log(`Kết quả: mode=${r.mode}${r.messageId ? `, messageId=${r.messageId}` : ''}`);
} catch (e) {
  console.error('Gửi mail thất bại:', e.message);
  process.exit(1);
}
