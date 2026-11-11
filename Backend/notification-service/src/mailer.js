// Nhiệm vụ: Gửi email qua Nodemailer SMTP. Nếu chưa cấu hình SMTP_USER/SMTP_PASS
// thì chuyển sang chế độ SIMULATOR (in nội dung email ra Terminal) để vẫn test được.
import nodemailer from 'nodemailer';

// Đọc cấu hình lúc gọi (không đọc lúc import) để chắc chắn dotenv đã load xong.
export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || '587');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465, // 465 = SSL, 587 = STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return transporter;
}

export function logMailerMode() {
  if (isSmtpConfigured()) {
    console.log(`[Notification Service] [MAILER] Chế độ SMTP (${process.env.SMTP_HOST || 'smtp.gmail.com'}:${process.env.SMTP_PORT || 587}, user=${process.env.SMTP_USER})`);
  } else {
    console.log('[Notification Service] [MAILER] Chưa cấu hình SMTP_USER/SMTP_PASS -> chế độ SIMULATOR (email sẽ được in ra Terminal)');
  }
}

/**
 * Gửi email. Trả về { mode: 'smtp' | 'simulator' }.
 * Ném lỗi nếu SMTP gửi thất bại — nơi gọi quyết định xử lý (service không bị crash).
 * `simulatorText` là nội dung hiển thị ở Terminal khi chạy simulator.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!isSmtpConfigured()) {
    const line = '='.repeat(64);
    console.log(`\n${line}\n[EMAIL SIMULATOR] Gửi tới: ${to}\n[EMAIL SIMULATOR] Tiêu đề: ${subject}\n${line}\n${text}\n${line}\n`);
    return { mode: 'simulator' };
  }

  const info = await getTransporter().sendMail({
    from: `"TDTU iBanking" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html
  });
  console.log(`[Notification Service] [MAILER] Đã gửi email SMTP tới ${to} (messageId=${info.messageId})`);
  return { mode: 'smtp' };
}
