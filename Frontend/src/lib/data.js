/**
 * Mock Data Repository for iBanking React App
 */

export const MOCK_ACCOUNTS = {
    "ACC001": {
        id: "ACC001",
        fullName: "Nguyễn Văn A",
        phone: "0912 345 678",
        email: "nguyenvana.banking@gmail.com",
        balance: 15000000,
        initials: "NV"
    },
    "ACC002": {
        id: "ACC002",
        fullName: "Trần Thị B",
        phone: "0987 654 321",
        email: "tranthib.banking@gmail.com",
        balance: 3500000,
        initials: "TB"
    },
    "ACC003": {
        id: "ACC003",
        fullName: "Lê Hoàng C",
        phone: "0909 123 456",
        email: "lehoangc.banking@gmail.com",
        balance: 50000000,
        initials: "HC"
    }
};

export const MOCK_STUDENTS = {
    "524H0129": {
        mssv: "524H0129",
        studentName: "Phùng Mau Tiến",
        faculty: "Công nghệ Thông tin",
        className: "24H50201",
        fees: [
            {
                feeId: "FEE-2024-HK1-0089",
                uid: "UID-98234711",
                price: 8500000,
                typeOfFee: "Học phí Học kỳ I (2024 - 2025)",
                createdAt: "15/08/2024 08:30",
                expiredAt: "15/10/2026 23:59",
                status: "Chưa thanh toán",
                description: "Bao gồm 15 tín chỉ lý thuyết + 3 tín chỉ thực hành Công nghệ Phần mềm & Kiến trúc SOA"
            },
            {
                feeId: "FEE-2024-LAB-0012",
                uid: "UID-98234712",
                price: 1200000,
                typeOfFee: "Lệ phí Thực hành Lab Cloud & SOA",
                createdAt: "16/08/2024 09:00",
                expiredAt: "20/10/2026 23:59",
                status: "Chưa thanh toán",
                description: "Chi phí máy chủ Cloud Lab & bản quyền phần mềm học tập"
            },
            {
                feeId: "FEE-2024-BHYT-004",
                uid: "UID-98234713",
                price: 893000,
                typeOfFee: "Bảo hiểm Y tế Sinh viên 2024",
                createdAt: "01/08/2024 10:00",
                expiredAt: "30/08/2024 23:59",
                status: "Đã thanh toán",
                description: "Khoản phí Bảo hiểm y tế bắt buộc cả năm học 2024 - 2025"
            }
        ]
    },
    "524H0024": {
        mssv: "524H0024",
        studentName: "Nguyễn Phong Phú",
        faculty: "Công nghệ thông tin",
        className: "24H50201",
        fees: [
            {
                feeId: "FEE-2024-HK1-0092",
                uid: "UID-77123904",
                price: 12200000,
                typeOfFee: "Học phí Học kỳ I (2024 - 2025)",
                createdAt: "18/08/2024 10:15",
                expiredAt: "20/10/2026 23:59",
                status: "Chưa thanh toán",
                description: "Học phí Khoa Tài chính Ngân hàng - 20 tín chỉ bắt buộc"
            },
            {
                feeId: "FEE-2024-TV-0088",
                uid: "UID-77123905",
                price: 600000,
                typeOfFee: "Phí Thư viện Digital & Giáo trình",
                createdAt: "19/08/2024 11:30",
                expiredAt: "25/10/2026 23:59",
                status: "Chưa thanh toán",
                description: "Quyền truy cập thư viện số toàn cầu & giáo trình bản quyền"
            }
        ]
    },
    "524H0041": {
        mssv: "524H0041",
        studentName: "Lê Quốc Tuấn",
        faculty: "Ngoại ngữ Thương mại",
        className: "D21_NN03",
        fees: [
            {
                feeId: "FEE-2024-HK1-0104",
                uid: "UID-44910283",
                price: 5400000,
                typeOfFee: "Học phí Học kỳ I (2024 - 2025)",
                createdAt: "20/08/2024 14:00",
                expiredAt: "25/10/2026 23:59",
                status: "Chưa thanh toán",
                description: "Học phí Khóa học Ngoại ngữ Tiếng Anh Chuyên ngành (12 tín chỉ)"
            }
        ]
    }
};

/**
 * Format currency number to Vietnamese Dong string
 */
export function formatVND(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) return '0 VNĐ';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}
