-- Snapshot scoring cho Pro Analysis — CHỈ áp dụng cho CHECK MỚI, KHÔNG backfill.
-- Mục đích: Evidence Pack server-side phải dùng ĐÚNG bộ số Jev mà client đã hiển thị,
-- và breakdown/reasoning/contributions phải là snapshot tại thời điểm check
-- (không phụ thuộc việc lib/scoring.ts hay keyword có bị sửa về sau).
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor.
-- KHÔNG có update nào trên bảng checks: dữ liệu lịch sử giữ nguyên, không bị ghi đè.

-- 1) Output chấm điểm của Jev, lưu nguyên giá trị thô provider trả về.
--    numeric để không mất precision của noul/confidence (0..1).
alter table public.checks
  add column if not exists jev_is_ngop numeric,
  add column if not exists jev_legal_safety numeric,
  add column if not exists jev_location_growth numeric,
  add column if not exists jev_liquidity numeric,
  add column if not exists jev_deal_confidence numeric;

-- 2) Snapshot đầy đủ tại thời điểm check (breakdown + contributions + reasoning + action)
alter table public.checks
  add column if not exists scoring_snapshot jsonb;

-- 3) Version do CODE chấm điểm tự khai (lib/scoring.ts -> SCORING_CODE_VERSION),
--    không lấy từ env. Check cũ để null = chưa xác định, không ghi version giả.
alter table public.checks
  add column if not exists scoring_code_version text;

comment on column public.checks.scoring_snapshot is
  'Snapshot scoring tai thoi diem check. Co gia tri = report phan anh dung ket qua luc user check. NULL = check cu, fallback tai day tu original_text.';
comment on column public.checks.scoring_code_version is
  'Version scoring code sinh ra score/snapshot. NULL = khong xac dinh duoc (khong ghi version gia).';
