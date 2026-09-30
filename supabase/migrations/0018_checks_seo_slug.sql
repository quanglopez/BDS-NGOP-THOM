-- Slug SEO cho URL báo cáo: /bao-cao/{seo_slug}
-- Report CŨ (đã tồn tại) không có slug -> URL /bao-cao/{uuid} vẫn chạy
-- được, vì route vẫn là /bao-cao/[id] và chấp nhận cả hai dạng.
--
-- seo_slug NULL  = report cũ, chưa backfill (không sao: fallback về UUID).
-- UNIQUE + NOT NULL trên cột để index lookup bằng = và không đụng nhau.
--
-- Lý do cần cột lưu (không dựng lại lúc đọc):
--   shortId là hash 6 ký tự từ UUID, KHÔNG phải prefix. Không có cách
--   nào truy vấn `checks.id` kiểu prefix vì Postgres không có toán tử
--   regex cho kiểu uuid. Nên phải lưu để so khớp chính xác.

alter table checks
  add column if not exists seo_slug text;

-- Index partial: chỉ report mới có slug mới cần tra cứu.
create unique index if not exists checks_seo_slug_key
  on checks (seo_slug)
  where seo_slug is not null;
