# BĐS Ngộp Thơm - Check kèo BĐS toàn quốc bằng AI

Tool SaaS cho môi giới bất động sản: dán tin / upload 100 tin Zalo → AI chấm điểm 6 tiêu chí → lọc kèo ngộp >80 điểm. Hỗ trợ 63 tỉnh/thành. Gói Free 20 tin/ngày, Pro 299k/tháng, Team 799k/tháng.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase (Auth Google + Postgres)
- Jev AI (qua `/api/check`, key chỉ ở server)
- SePay VietQR (thanh toán, webhook tự nâng gói)

## Cấu trúc

```
app/
  page.tsx                  # Landing bán hàng + ô check
  pricing/page.tsx          # Bảng giá + thanh toán VietQR
  login/page.tsx            # Đăng nhập Google
  dashboard/page.tsx        # Lịch sử + stats + Bulk Check + affiliate
  api/check/route.ts        # Chấm điểm 1 tin qua Jev (auth + quota)
  api/payments/...          # Tạo + poll thanh toán
  api/sepay/webhook/route.ts# Webhook ngân hàng -> nâng plan
  api/referral/route.ts     # Mã giới thiệu +10 check
  api/auth/...              # OAuth callback + signout
components/site|dashboard|auth|pricing|ui/
lib/                        # scoring, quota, payments, referral, supabase clients
supabase/schema.sql         # users, checks, payments + RLS
```

## Cài đặt local

```bash
cp .env.example .env.local   # điền các biến bên dưới
npm install
npm run dev                  # http://localhost:3000
```

## Biến môi trường

| Biến | Ở đâu | Ghi chú |
| --- | --- | --- |
| `JEV_API_KEY` | server | Key Jev, KHÔNG prefix `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SUPABASE_URL` | public | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Cho webhook + referral (RLS bypass) |
| `SEPAY_API_KEY` | server | Webhook SePay (`Authorization: Apikey <key>`) |
| `NEXT_PUBLIC_SEPAY_BANK` | public | Mã ngân hàng nhận tiền, ví dụ `MBB` |
| `NEXT_PUBLIC_SEPAY_ACCOUNT` | public | Số tài khoản nhận tiền |
| `NEXT_PUBLIC_SEPAY_BANK_NAME` | public | Tên ngân hàng hiển thị |

## Deploy Vercel

1. **Supabase**: tạo project → SQL Editor → chạy `supabase/schema.sql`
   - Authentication → Providers: bật **Google** (nhập Google OAuth Client ID/Secret, redirect URL `https://<domain>/api/auth/callback`)
   - Đã chạy `schema.sql` rồi thì chỉ cần chạy các file trong `supabase/migrations/` theo thứ tự tên (chúng idempotent)
2. **Vercel**: import repo (auto-detect Next.js) → Environment Variables: thêm bảng trên → Deploy
3. **SePay**: tạo API key → cấu hình webhook trỏ `https://<domain>/api/sepay/webhook`
   - Khi khách chuyển khoản đúng nội dung `NANGCAP {user_id}` + số tiền ≥ giá gói → webhook tự nâng plan Pro/Team

## Quy tắc bảo mật

- `JEV_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SEPAY_API_KEY` chỉ đọc ở server (route handler). Không dùng `NEXT_PUBLIC_`.
- Client chỉ gọi qua các route `/api/*`.
- `/api/check` yêu cầu đăng nhập + giới hạn lượt/ngày theo gói (Free 20, Pro 500), có credits thưởng từ giới thiệu bạn bè.

## Test nhanh

1. Đăng nhập Google → Dashboard
2. Dán: `Bán gấp! Nhà mặt tiền Thùy Vân 80m2, ngân hàng thanh lý, giá 5.5 tỷ rẻ hơn thị trường 1 tỷ sổ hồng riêng` → expect ~88/100 KÈO NGỘP NGON
3. Upload `.txt` 100 dòng ở Bulk Check → filter >80 → Xuất Excel
4. Chuyển khoản test nội dung `NANGCAP {user_id}` 299.000đ → plan nâng lên Pro trong 1-2 phút
