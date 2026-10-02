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
| `CRON_SECRET` | server | Chuỗi bất kỳ, Vercel Cron gửi `Authorization: Bearer <CRON_SECRET>` |

## Radar — quét định kỳ

Radar có hai đường quét: nút "Quét ngay" của người dùng (`POST /api/radars/[id]/scan`) và
lịch tự động cho **mọi Radar đang chạy** (`GET /api/cron/radar-scan`, khai báo trong `vercel.json`).

- Lịch: `7 3 * * *` — 03:07 mỗi ngày (giờ UTC). Chọn giờ lệch phút để không trùng giờ đông của các job khác.
- Xác thực: bắt buộc `Authorization: Bearer <CRON_SECRET>`; so sánh thời gian cố định.
  Không có `CRON_SECRET` thì route trả **500 và quét đại** — cố ý fail-closed.
- Thứ tự: Radar `status = ACTIVE`, quét lâu nhất trước (`checked_at` tăng dần, chưa quét lên đầu).
- Giới hạn mỗi lượt: tối đa **50** Radar, nghỉ **30 phút** giữa hai lượt của cùng một Radar,
  nghỉ 250ms giữa các Radar. Nếu vượt số Radar, lượt sau tự động xử lý tiếp (không có cron phụ).
- Cô lập lỗi: một Radar lỗi không dừng cả lượt; Radar đó bị ghi `last_scan_error = "scan_failed"`.
- Response (để kiểm tra trong Vercel → Cron → Logs):

  ```json
  { "ok": true, "total": 12, "scanned": 12, "skipped": 0, "failed": 0,
    "newMatches": 34, "errors": [] }
  ```

- Quét cần service role (đọc `market_listings`/`checks`, ghi `radar_matches`) nên chạy bằng
  `adminClient()`; người dùng vẫn chỉ đọc `radars`/`radar_matches` của chính mình qua session client + RLS.
- Kiểm tra thủ công (chỉ local hoặc preview có secret):

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/radar-scan
  ```

  Không có header → 401. Có header sai → 401. Có header đúng → JSON tổng kết ở trên.

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
