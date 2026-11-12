// Nhiệm vụ: Gửi email qua Nodemailer SMTP.
//  - Có SMTP_HOST  -> chế độ SMTP (Mailpit mặc định của Docker, hoặc Gmail thật).
//  - Không có SMTP_HOST -> chế độ SIMULATOR (in nội dung email ra Terminal) để vẫn test được.
//  - MAIL_TO_OVERRIDE (tùy chọn): mọi mail gửi tới địa chỉ này thay cho email trong DB.
import nodemailer from 'nodemailer';

// Đọc cấu hình lúc gọi (không đọc lúc import) để chắc chắn dotenv đã load xong.
export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

export function getMailMode() {
  return isSmtpConfigured() ? 'smtp' : 'simulator';
}

export function getMailOverride() {
  return (process.env.MAIL_TO_OVERRIDE || '').trim();
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || '587');
    const options = {
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 = SSL, 587 = STARTTLS
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    };
    // Mailpit không cần đăng nhập: chỉ thêm auth khi có đủ cả user và pass
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      options.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    }
    transporter = nodemailer.createTransport(options);
  }
  return transporter;
}

function getFrom() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@tdtu-ibanking.local';
}

export function logMailerMode() {
  if (isSmtpConfigured()) {
    const auth = process.env.SMTP_USER && process.env.SMTP_PASS ? `user=${process.env.SMTP_USER}` : 'không đăng nhập';
    console.log(`[Notification Service] [MAILER] Chế độ SMTP (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}, ${auth})`);
    if (getMailOverride()) {
      console.log(`[Notification Service] [MAILER] MAIL_TO_OVERRIDE đang bật: mọi mail sẽ gửi tới ${getMailOverride()}`);
    }
  } else {
    console.log('[Notification Service] [MAILER] Chưa cấu hình SMTP_HOST -> chế độ SIMULATOR (email sẽ được in ra Terminal)');
  }
}

/**
 * Gửi email. Trả về { mode: 'smtp' | 'simulator', messageId? }.
 * Ném lỗi nếu SMTP gửi thất bại — nơi gọi quyết định xử lý (service không bị crash).
 */
export async function sendMail({ to, subject, text, html }) {
  if (!isSmtpConfigured()) {
    const line = '='.repeat(64);
    console.log(`\n${line}\n[EMAIL SIMULATOR] Gửi tới: ${to}\n[EMAIL SIMULATOR] Tiêu đề: ${subject}\n${line}\n${text}\n${line}\n`);
    return { mode: 'simulator' };
  }

  let realTo = to;
  const override = getMailOverride();
  if (override) {
    console.log(`[Notification Service] [MAILER] MAIL_TO_OVERRIDE: ${to} -> ${override}`);
    realTo = override;
    text = `${text}\n\nNgười nhận gốc: ${to}`;
    html = `${html}<p style="color:#888;font-size:12px">Người nhận gốc: ${String(to).replace(/[&<>"']/g, '')}</p>`;
  }

  const info = await getTransporter().sendMail({
    from: `"TDTU iBanking" <${getFrom()}>`,
    to: realTo,
    subject,
    text,
    html
  });
  console.log(`[Notification Service] [MAILER] Đã gửi email SMTP tới ${realTo} (messageId=${info.messageId})`);
  return { mode: 'smtp', messageId: info.messageId };
}
