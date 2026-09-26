-- Thêm cột tỉnh + giá + diện tích vào bảng checks để lưu chi tiết mỗi lần check
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.checks
  add column if not exists province text,
  add column if not exists price_billion numeric,
  add column if not exists area_m2 integer;

-- Backfill tỉnh cho dữ liệu cũ (idempotent, an toàn)
update public.checks
set province = case
  when lower(original_text) like '%hà nội%' or lower(original_text) like '%ha noi%' then 'Hà Nội'
  when lower(original_text) like '%hồ chí minh%' or lower(original_text) like '%sài gòn%' or lower(original_text) like '%sai gon%' or lower(original_text) like '%thủ đức%' then 'TP.HCM'
  when lower(original_text) like '%đà nẵng%' or lower(original_text) like '%da nang%' then 'Đà Nẵng'
  when lower(original_text) like '%hải phòng%' or lower(original_text) like '%hai phong%' then 'Hải Phòng'
  when lower(original_text) like '%cần thơ%' or lower(original_text) like '%can tho%' then 'Cần Thơ'
  when lower(original_text) like '%nha trang%' or lower(original_text) like '%khánh hòa%' then 'Nha Trang'
  when lower(original_text) like '%huế%' or lower(original_text) like '%hue%' then 'Huế'
  when lower(original_text) like '%vũng tàu%' or lower(original_text) like '%vung tau%' or lower(original_text) like '%thùy vân%' then 'Vũng Tàu'
  when lower(original_text) like '%quảng ninh%' or lower(original_text) like '%hạ long%' then 'Quảng Ninh'
  when lower(original_text) like '%bình dương%' or lower(original_text) like '%thủ dầu một%' then 'Bình Dương'
  when lower(original_text) like '%đồng nai%' or lower(original_text) like '%biên hòa%' then 'Đồng Nai'
  when lower(original_text) like '%đà lạt%' or lower(original_text) like '%lâm đồng%' then 'Lâm Đồng'
  when lower(original_text) like '%phú quốc%' or lower(original_text) like '%kiên giang%' then 'Kiên Giang'
  when lower(original_text) like '%quy nhơn%' or lower(original_text) like '%bình định%' then 'Bình Định'
  when lower(original_text) like '%ninh bình%' then 'Ninh Bình'
  else province
end
where province is null;

-- Backfill giá + diện tích cho dữ liệu cũ
update public.checks
set price_billion = case
  when price_billion is null and original_text ~ '(\d+[\.,]?\d*)\s*tỷ'
    then nullif(regexp_replace(substring(original_text from '(\d+[\.,]?\d*)\s*tỷ'), ',', '.'), '')::numeric
  else price_billion
end,
area_m2 = case
  when area_m2 is null and original_text ~ '(\d+)\s*m2'
    then substring(original_text from '(\d+)\s*m2')::integer
  else area_m2
end
where price_billion is null or area_m2 is null;
