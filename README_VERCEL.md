# BĐS Ngộp Thơm - Next.js 14 (App Router)

Tool check kèo BĐS ngộp cho môi giới Vũng Tàu. Frontend Next.js + Tailwind + shadcn/ui, backend Route Handler gọi Jev API.

## Cấu trúc

- `app/page.tsx` - trang chủ (hero + ô check + bảng giá + CTA)
- `app/api/check/route.ts` - POST {text} -> gọi Jev -> trả điểm 0-100 + 5 chỉ số phụ
- `components/site/` - UI trang chủ tách component
- `components/ui/` - shadcn/ui primitives (button, textarea, card, badge)
- `lib/scoring.ts` - chấm điểm local (fallback khi thiếu JEV_API_KEY)

## Chạy local

```bash
cp .env.example .env.local   # dán JEV_API_KEY vào
npm install
npm run dev                  # http://localhost:3000
```

Test với Vercel CLI:

```bash
vercel dev
```

## Deploy Vercel

1. `vercel.com/new` -> import repo này (framework auto-detect Next.js)
2. Settings -> Environment Variables -> thêm `JEV_API_KEY`
3. Deploy

## Test nhanh

Dán: `Bán gấp! Nhà mặt tiền Thùy Vân 80m2, ngân hàng thanh lý, giá 5.5 tỷ rẻ hơn thị trường 1 tỷ sổ hồng riêng`

Expected: 88/100 KÈO NGỘP NGON

## Quy tắc env

- `JEV_API_KEY` chỉ đọc trong route handler (server). Không prefix `NEXT_PUBLIC_`, không bundle ra client.
- Client chỉ gọi qua `POST /api/check`.
