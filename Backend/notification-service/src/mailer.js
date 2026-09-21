// =========================================================================
// FILE: src/mailer.js - CẤU HÌNH GỬI EMAIL QUA GIAO THỨC SMTP
// =========================================================================

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// 1. CẤU HÌNH BỘ CHUYỂN PHÁT THƯ (TRANSPORTER)
// Nếu bạn điền email và mật khẩu trong file .env -> Sẽ kết nối máy chủ Gmail SMTP thật
// Nếu chưa điền -> Tự động chuyển sang chế độ Simulator (in email ra màn hình Terminal để test nhanh)
let transporter;

if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // dùng cổng 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER, // Địa chỉ Gmail của bạn
      pass: process.env.SMTP_PASS  // Mật khẩu ứng dụng 16 ký tự do Google cấp
    }
  });
  console.log(`[Notification Service] Đã kích hoạt chế độ gửi Gmail SMTP thật: ${process.env.SMTP_USER}`);
} else {
  // Chế độ giả lập (Simulator) phục vụ chấm bài nhanh tại lớp
  transporter = {
    sendMail: async (mailOptions) => {
      console.log('\n================== [HÒM THƯ EMAIL SIMULATOR] ==================');
      console.log(`Người nhận: ${mailOptions.to}`);
      console.log(`Tiêu đề:    ${mailOptions.subject}`);
      console.log(`Nội dung:   ${mailOptions.text || 'Email có định dạng HTML'}`);
      console.log('===============================================================\n');
      return { messageId: 'simulated-' + Date.now() };
    }
  };
  console.log('[Notification Service] Đang dùng Email Simulator (Mã OTP sẽ được in ra Terminal để chấm bài thuận tiện)');
}

// 2. HÀM GỬI EMAIL CHỨA MÃ OTP 6 CHỮ SỐ
export async function sendOtpEmail(toEmail, otpCode, transactionId, amount) {
  const mailOptions = {
    from: `"iBanking TDTU" <${process.env.SMTP_USER || 'no-reply@ibanking.tdtu.edu.vn'}>`,
    to: toEmail,
    subject: `[iBanking TDTU] Mã xác thực OTP cho giao dịch đóng học phí`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="text-align: center; border-bottom: 2px solid #c82333; padding-bottom: 15px;">
          <h2 style="color: #c82333; margin: 0;">iBanking - Đại Học Tôn Đức Thắng</h2>
          <p style="color: #64748b; margin: 5px 0 0 0;">Phân hệ thanh toán học phí trực tuyến</p>
        </div>
        <div style="padding: 20px 0;">
          <p>Kính chào Quý khách,</p>
          <p>Quý khách đang thực hiện giao dịch thanh toán học phí với số tiền <strong>${Number(amount).toLocaleString('vi-VN')} đ</strong> trên hệ thống iBanking.</p>
          <p>Mã giao dịch: <code>${transactionId}</code></p>
          <div style="text-align: center; margin: 25px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e293b; background-color: #f1f5f9; padding: 12px 24px; border-radius: 6px; border: 1px dashed #cbd5e1;">
              ${otpCode}
            </span>
          </div>
          <p style="color: #c82333; font-size: 14px; text-align: center;">
            ⚠️ Mã OTP có hiệu lực tối đa trong <strong>5 phút</strong> và chỉ được sử dụng một lần. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.
          </p>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 12px; color: #94a3b8; text-align: center;">
          <p>Email này được tạo tự động từ hệ thống SOA iBanking TDTU. Vui lòng không trả lời thư này.</p>
        </div>
      </div>
    `,
    text: `Mã OTP xác thực giao dịch ${transactionId} của bạn là: ${otpCode}. Hiệu lực trong 5 phút.`
  };

  return await transporter.sendMail(mailOptions);
}

// 3. HÀM GỬI EMAIL BIÊN LAI KHI THANH TOÁN THÀNH CÔNG
export async function sendReceiptEmail(toEmail, data) {
  const mailOptions = {
    from: `"iBanking TDTU" <${process.env.SMTP_USER || 'no-reply@ibanking.tdtu.edu.vn'}>`,
    to: toEmail,
    subject: `[iBanking TDTU] Biên lai thanh toán học phí thành công - GD ${data.transaction_id}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #10b981; border-radius: 8px;">
        <div style="text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 15px;">
          <h2 style="color: #10b981; margin: 0;">GIAO DỊCH THÀNH CÔNG</h2>
          <p style="color: #64748b; margin: 5px 0 0 0;">Biên lai xác nhận nộp học phí TDTU</p>
        </div>
        <div style="padding: 20px 0;">
          <p>Kính chào <strong>${data.full_name}</strong>,</p>
          <p>Khoản học phí đã được thanh toán thành công với chi tiết như sau:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">Mã giao dịch:</td>
              <td style="padding: 8px 0; font-weight: bold; text-align: right;">${data.transaction_id}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">MSSV:</td>
              <td style="padding: 8px 0; font-weight: bold; text-align: right;">${data.student_id}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">Họ tên sinh viên:</td>
              <td style="padding: 8px 0; font-weight: bold; text-align: right;">${data.student_name}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">Số tiền thanh toán:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #c82333; text-align: right; font-size: 18px;">${Number(data.amount).toLocaleString('vi-VN')} đ</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">Thời gian hoàn tất:</td>
              <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleString('vi-VN')}</td>
            </tr>
          </table>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 12px; color: #94a3b8; text-align: center;">
          <p>Cảm ơn Quý khách đã sử dụng dịch vụ iBanking ĐH Tôn Đức Thắng.</p>
        </div>
      </div>
    `
  };

  return await transporter.sendMail(mailOptions);
}
