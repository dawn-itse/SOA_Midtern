// =========================================================================
// SCRIPT KIỂM THỬ TỰ ĐỘNG TOÀN DIỆN CHO AUTH-SERVICE VÀ TUITION-SERVICE
// =========================================================================

async function runTests() {
  console.log('===============================================================');
  console.log('BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG AUTH-SERVICE & TUITION-SERVICE');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name}`);
    }
  }

  let token = null;

  // -------------------------------------------------------------
  // TEST PHẦN 1: AUTH-SERVICE (PORT 8001)
  // -------------------------------------------------------------
  console.log('--- KIỂM THỬ AUTH-SERVICE (CỔNG 8001) ---');

  // Test 1.1: Đăng nhập sai mật khẩu -> Phải trả về 401
  try {
    const res = await fetch('http://localhost:8001/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nguyenvana', password: 'wrongpassword' })
    });
    assert(res.status === 401, '1.1. Đăng nhập sai mật khẩu bị chặn với mã HTTP 401');
  } catch (e) {
    assert(false, '1.1. Lỗi kết nối login: ' + e.message);
  }

  // Test 1.2: Đăng nhập đúng thông tin nguyenvana / password123 -> Trả về 200 + Token + User
  try {
    const res = await fetch('http://localhost:8001/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nguyenvana', password: 'password123' })
    });
    const data = await res.json();
    token = data.data?.token;
    assert(res.status === 200 && data.success === true && !!token, '1.2. Đăng nhập thành công trả về HTTP 200 và JWT Token');
    assert(data.data?.user?.username === 'nguyenvana', '1.3. Thông tin người dùng đúng là nguyenvana');
    assert(typeof data.data?.user?.balance === 'number', '1.4. Số dư khả dụng trả về dạng số (Number)');
  } catch (e) {
    assert(false, '1.2. Lỗi đăng nhập đúng: ' + e.message);
  }

  // Test 1.5: Gọi /profile không có Token -> Phải bị chặn 401
  try {
    const res = await fetch('http://localhost:8001/profile');
    assert(res.status === 401, '1.5. Gọi /profile không mang Token bị chặn mã HTTP 401 (Protected Route)');
  } catch (e) {
    assert(false, '1.5. Lỗi: ' + e.message);
  }

  // Test 1.6: Gọi /profile CÓ mang Bearer Token hợp lệ -> Trả về thông tin cá nhân mới nhất
  try {
    const res = await fetch('http://localhost:8001/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert(res.status === 200 && data.success === true, '1.6. Xác thực vé Token thành công, trả về profile 200 OK');
    assert(data.data?.username === 'nguyenvana', '1.7. Profile khớp đúng người dùng trong Token');
  } catch (e) {
    assert(false, '1.6. Lỗi profile: ' + e.message);
  }

  // Test 1.8: Gọi trừ tiền nội bộ /internal/deduct với số tiền vượt quá số dư -> Báo lỗi 400
  try {
    const res = await fetch('http://localhost:8001/internal/deduct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'ACC001',
        amount: 9999999999, // 9 tỷ, chắc chắn không đủ
        transaction_id: 'TXN-TEST-OVER'
      })
    });
    const data = await res.json();
    assert(res.status === 400 && data.success === false, '1.8. Trừ tiền vượt số dư bị từ chối với mã HTTP 400 (Double Spending Defense)');
  } catch (e) {
    assert(false, '1.8. Lỗi deduct vượt số dư: ' + e.message);
  }

  console.log('\n--- KIỂM THỬ TUITION-SERVICE (CỔNG 8002) ---');

  // Test 2.1: Tra cứu MSSV không tồn tại -> Trả về 404
  try {
    const res = await fetch('http://localhost:8002/lookup/MSSV_KHONG_TON_TAI');
    assert(res.status === 404, '2.1. Tra cứu MSSV ảo trả về HTTP 404 Not Found');
  } catch (e) {
    assert(false, '2.1. Lỗi: ' + e.message);
  }

  // Test 2.2: Tra cứu MSSV hợp lệ (524H0024 - Nguyễn Phong Phú)
  try {
    const res = await fetch('http://localhost:8002/lookup/524H0024');
    const data = await res.json();
    assert(res.status === 200 && data.success === true, '2.2. Tra cứu MSSV 524H0024 thành công trả về HTTP 200');
    assert(data.data?.student?.studentName === 'Nguyễn Phong Phú', '2.3. Tên sinh viên đúng là Nguyễn Phong Phú');
    assert(data.data?.student?.className === '24H50201', '2.4. Tên lớp đúng là 24H50201 (thuộc tính className)');
    assert(Array.isArray(data.data?.student?.fees) && data.data.student.fees.length > 0, '2.5. Danh sách học phí trả về dạng mảng hợp lệ');
    assert(data.data.student.fees[0].feeId !== undefined, '2.6. Thuộc tính feeId đã chuẩn hóa đúng chuẩn camelCase cho React');
    assert(typeof data.data.student.fees[0].price === 'number', '2.7. Giá tiền đã được parse sang dạng số (Number)');
  } catch (e) {
    assert(false, '2.2. Lỗi tra cứu: ' + e.message);
  }

  // Test 2.8: Tra cứu MSSV khác (524H0129 - Phùng Mau Tiến)
  try {
    const res = await fetch('http://localhost:8002/lookup/524H0129');
    const data = await res.json();
    assert(res.status === 200 && data.data?.student?.studentName === 'Phùng Mau Tiến', '2.8. Tra cứu MSSV 524H0129 đúng Phùng Mau Tiến');
  } catch (e) {
    assert(false, '2.8. Lỗi: ' + e.message);
  }

  // Test 2.9: Gạch nợ học phí an toàn (Chống Double Payment)
  const testFeeId = 'FEE-2024-HK1-0092'; // Khoản học phí của 524H0024
  try {
    // Đảm bảo trước khi test, học phí đang ở trạng thái 'Chưa thanh toán'
    await fetch('http://localhost:8002/internal/revert-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee_id: testFeeId, transaction_id: 'TXN-RESET' })
    });

    // LẦN 1: Gạch nợ lần đầu -> Phải THÀNH CÔNG
    const res1 = await fetch('http://localhost:8002/internal/mark-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee_id: testFeeId, transaction_id: 'TXN-TEST-1' })
    });
    const data1 = await res1.json();
    assert(res1.status === 200 && data1.success === true, '2.9. Gạch nợ học phí lần đầu thành công HTTP 200');

    // LẦN 2: Cùng mã học phí đó đóng lần thứ 2 (Giả lập người thứ 2 đóng trùng) -> BẮT BUỘC PHẢI BỊ CHẶN (409)
    const res2 = await fetch('http://localhost:8002/internal/mark-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee_id: testFeeId, transaction_id: 'TXN-TEST-2' })
    });
    const data2 = await res2.json();
    assert(res2.status === 409 && data2.success === false, '2.10. CHỐNG DOUBLE PAYMENT: Người thứ 2 cùng đóng bị chặn ngay lập tức với mã HTTP 409');

    // LẦN 3: Bù hoàn Saga (Revert lại trạng thái Chưa thanh toán) -> Phải thành công
    const res3 = await fetch('http://localhost:8002/internal/revert-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee_id: testFeeId, transaction_id: 'TXN-TEST-SAGA' })
    });
    const data3 = await res3.json();
    assert(res3.status === 200 && data3.success === true, '2.11. SAGA REVERT: Hoàn tác trạng thái học phí về "Chưa thanh toán" thành công');
  } catch (e) {
    assert(false, '2.9. Lỗi kiểm tra gạch nợ: ' + e.message);
  }

  console.log('\n===============================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ĐẠT ${passed}/${total} BÀI TEST (${Math.round(passed/total*100)}%)`);
  console.log('===============================================================');
}

runTests();
