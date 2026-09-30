// Backfill seo_slug cho report đã tồn tại (đã có id, chưa có slug).
//
// VÌ SAO LÀ SCRIPT CHỨ KHÔNG PHẢI MIGRATION SQL:
// slug phụ thuộc shortId() — hash của 8 ký tự hex đầu UUID. Không có
// cách nào viết lại đúng hash đó bằng SQL thuần, nên SQL sẽ SINH SLUG
// KHÁC hàm TS -> URL backfill không tìm thấy report. Script này import
// chính lib/report/slug.ts nên không thể lệch.
//
// Dùng service role (bảng checks không có update policy cho user).
//
// PHẢI qua loader của tests/ để resolve import dạng .ts — chạy thẳng
// `node --experimental-strip-types scripts/...` sẽ fail ở import.
// Chạy:
//   node --experimental-strip-types --import ./tests/register-loader.mjs \
//     scripts/backfill-seo-slug.ts [--dry-run] [--limit=N]
// Tuỳ chọn: --dry-run (chỉ báo cáo, không ghi), --limit=N (mặc định 500)

import { createClient } from "@supabase/supabase-js";
import { buildReportSlug } from "../lib/report/slug";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 500;

// Chỉ log id + slug, KHÔNG log original_text (PII: tên/SĐT trong tin).
const log = (...a: unknown[]) => console.log(...a);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Thiếu biến môi trường ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { data: rows, error } = await supabase
    .from("checks")
    .select("id, original_text, province, price_billion")
    .is("seo_slug", null)
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  if (error) {
    console.error(`Đọc checks thất bại: ${error.code ?? "unknown"} ${error.message}`);
    console.error("Nếu là lỗi cột seo_slug, hãy chạy migration 0018 trước.");
    process.exit(1);
  }

  const total = rows.length;
  log(`Tìm thấy ${total} report chưa có seo_slug${DRY_RUN ? " (DRY RUN)" : ""}`);

  if (total === 0) {
    log("Không có gì để làm.");
    return;
  }

  let ok = 0;
  let collide = 0;
  let failed = 0;

  for (const r of rows) {
    const slug = buildReportSlug({
      id: r.id,
      title: (r.original_text ?? "").split("\n")[0] ?? "",
      province: r.province,
      price:
        typeof r.price_billion === "number" && r.price_billion > 0 ? r.price_billion * 1e9 : null,
    });

    if (!slug) {
      failed += 1;
      log(`  [skip] short_id rỗng`);
      continue;
    }

    if (DRY_RUN) {
      ok += 1;
      log(`  ${r.id} -> ${slug}`);
      continue;
    }

    const { error: upErr } = await supabase.from("checks").update({ seo_slug: slug }).eq("id", r.id);
    if (upErr) {
      if (upErr.code === "23505") {
        // UNIQUE: 2 report trùng slug. Report này giữ NULL -> URL UUID
        // vẫn mở, không mất dữ liệu.
        collide += 1;
        log(`  [trùng slug] giữ NULL, dùng URL UUID: ${r.id}`);
      } else {
        failed += 1;
        log(`  [lỗi] ${r.id} code=${upErr.code ?? "unknown"}`);
      }
      continue;
    }
    ok += 1;
  }

  log("");
  log(`Kết quả: ${ok} ok, ${collide} trùng slug (giữ NULL), ${failed} lỗi / bỏ qua`);
  // rows.length === LIMIT nghĩa là còn dư phía sau -> nếu im lặng thì các
  // report đó mãi mãi không có slug mà không ai biết. Phải nói to.
  if (total === LIMIT) {
    log(
      `CẢNH BÁO: đã chạm giới hạn ${LIMIT} report/lần — còn dư ở lần sau. ` +
        `Chạy lại cho tới khi báo "Không có gì để làm", hoặc tăng --limit.`,
    );
    if (!DRY_RUN) process.exitCode = 2;
  }
  if (!DRY_RUN && ok > 0) log("URL cũ /bao-cao/{uuid} giờ 308 sang slug.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
