-- P1 Price Intelligence V2 - tach ma PHUONG khoi ma QUAN trong gazetteer.
--
-- VI SAO CAN:
-- Gateway gateway.chotot.com tra HAI loai ma khac nhau cho cung mot dia danh:
--   ward  (vi du 6885)   -> dung cho scope_key, noi scope la "phuong"
--   area  (vi du 301704) -> dung cho tham so loc area_v2 khi crawl
-- Tham so loc area_v2 cua gateway CHI hieu ma QUAN: doi area_v2=6885 tra HTTP 200
-- nhung 0 tin. Truoc day ca hai muc dich dung chung mot so, nen scope_key ghi
-- ma quan cho mot ten phuong (sai dia ly nhung rat de loi qua) hoac crawl tra
-- 0 mau. Bay gi moi cot giu tach.
--
-- Khong sua migration da duyet (0011-0015). Idempotent, khong dung bang checks
-- hay market_listings.

alter table public.geo_area_map
  add column if not exists ward_v2 integer;

comment on column public.geo_area_map.ward_v2 is
  'Ma PHUONG/XA cua gateway (vi du 6885). NULL = dong nay chi biet ma QUAN. dung cho scope_key.';

comment on column public.geo_area_map.area_v2 is
  'Ma QUAN/HUYEN cua gateway (vi du 301704). Dung cho tham so loc area_v2 khi crawl. Khong dung lam ma scope.';

-- XOA TOAN BO CACHE.
--
-- Bat buoc, khong phai don dep cho dep: truoc migration nay, mot dong ghi duoc
-- mot ma duy nhat cho cap (tinh, ten). voi ten PHUONG, ma do la ma QUAN. Doc
-- nhung dong cu sau khi tach hai cap se tra ma quan cho scope_key — dung cai
-- loi vua moi sua, lan nay la tu cache.
--
-- Xoa an toan: day la cache khoi tao lai duoc, khong phai nguon su that. Comment
-- cua 0015 da noi ro "Chi ghi khi da xac nhan khop chinh xac" va khong co TTL.
-- Lan resolve lai se ghi lai dong dung cap.
delete from public.geo_area_map;
