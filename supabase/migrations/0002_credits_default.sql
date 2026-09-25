-- Sửa lỗi: credits mặc định 20 khiến user Free có 40 lượt/ngày thay vì 20
-- credits chỉ dành cho check thưởng từ giới thiệu bạn bè (+10/lần)
alter table public.users alter column credits set default 0;

-- User chưa từng được giới thiệu: credits về 0
update public.users set credits = 0 where referred_by is null and credits <> 0;

-- User đã có referral: trừ đúng 20 (phần mặc định cũ), giữ lại phần thưởng
update public.users set credits = greatest(credits - 20, 0) where referred_by is not null;
