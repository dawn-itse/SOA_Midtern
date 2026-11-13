# Frontend - TDTU iBanking

React + Vite + Tailwind. Gọi mọi API qua API Gateway (mặc định http://localhost:8000).

- Chạy cùng hệ thống: `docker compose up -d --build` (thư mục gốc), mở http://localhost:5173
- Chạy dev: `npm install && npm run dev`
- Đổi địa chỉ gateway: đặt `VITE_API_GATEWAY_URL` trong `.env.local`