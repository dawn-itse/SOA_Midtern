/**
 * Tiện ích dùng chung. (Dữ liệu giả đã được xóa:
 * UI phải lấy dữ liệu thật từ backend, không che lỗi bằng dữ liệu giả.)
 */

/**
 * Format currency number to Vietnamese Dong string
 */
export function formatVND(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) return '0 VNĐ';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}
