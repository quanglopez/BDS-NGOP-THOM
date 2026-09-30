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

// Script chạy bằng `node` trần, KHÔNG qua Next.js -> không có
// loadEnvConfig sẵn. Nếu chỉ đọc process.env thì mọi secret trong
// .env.local đều vô hình và script chết ngay ở requireEnv. loadEnvFile là
// API built-in của Node (>=20.12), không cần dep. Bọc try/catch vì trên
// Vercel/CI biến đã có sẵn và không có file .env.local.
const ENV_FILES = [".env.local", ".env"] as const;

function loadLocalEnvIfMissing(): void {
  for (const f of ENV_FILES) {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    try {
      process.loadEnvFile(f);
    } catch {
      // Không có file -> thử file sau, cuối cùng requireEnv sẽ báo rõ.
    }
  }
}

/**
 * URL Supabase. Script này và app đọc TÊN BIẾN KHÁC NHAU: app dùng
 * NEXT_PUBLIC_*, script cũ chỉ đọc SUPABASE_URL -> chạy local bị chặn vì
 * .env.local không có SUPABASE_URL. Chấp nhận cả hai, ưu tiên SUPABASE_URL
 * (server-only, không bị Next inline vào client bundle).
 */
const SUPABASE_URL_KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;

function resolveSupabaseUrl(): string {
  for (const k of SUPABASE_URL_KEYS) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  console.error(
    "Thiếu URL Supabase: cần một trong hai biến sau được đặt trong môi trường " +
      "hoặc .env.local:\n" +
      SUPABASE_URL_KEYS.map((k) => `  - ${k}`).join("\n"),
  );
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Thiếu biến môi trường ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  loadLocalEnvIfMissing();

  const supabase = createClient(
    resolveSupabaseUrl(),
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

  // Slug ứng viên cho MỌI report, gộp trước khi ghi: dry-run cần biết
  // trùng để báo cáo, run thật thì bỏ qua trước khi tốn một UPDATE thất bại.
  type Cand = { id: string; slug: string };
  const cands: Cand[] = [];
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
      log(`  [skip] short_id rỗng -> giữ URL UUID: ${r.id}`);
      continue;
    }
    cands.push({ id: r.id, slug });
  }

  // Trùng trong chính lô này: 2 report mới sinh cùng slug. Chỉ 1 kẻ được
  // ghi, kẻ còn lại rơi về URL UUID.
  const dupInBatch = new Set<string>();
  const owner = new Map<string, string>();
  for (const c of cands) {
    const prev = owner.get(c.slug);
    if (prev) dupInBatch.add(c.slug);
    else owner.set(c.slug, c.id);
  }

  // Trùng với slug ĐÃ có trong DB. Cột seo_slug có UNIQUE nên nếu không
  // hỏi trước thì mỗi record là một UPDATE chắc chắn lỗi 23505.
  const taken = new Set<string>();
  for (let i = 0; i < cands.length; i += 100) {
    const chunk = cands.slice(i, i + 100).map((c) => c.slug);
    const { data: hit, error: hitErr } = await supabase
      .from("checks")
      .select("seo_slug")
      .in("seo_slug", chunk);
    if (hitErr) {
      console.error(`Đọc seo_slug đã tồn tại thất bại: ${hitErr.code ?? "unknown"} ${hitErr.message}`);
      process.exit(1);
    }
    for (const h of hit ?? []) if (h.seo_slug) taken.add(h.seo_slug);
  }

  const free = cands.filter((c) => !taken.has(c.slug) && !dupInBatch.has(c.slug));
  const blocked = cands.length - free.length;

  if (DRY_RUN) {
    log("");
    log("── DRY RUN (không ghi DB) ──");
    log(`Số record cần update : ${free.length}`);
    log(`Bị chặn (trùng slug)  : ${blocked}  (trong lô: ${dupInBatch.size}, đã có trong DB: ${
      cands.filter((c) => taken.has(c.slug)).length
    })`);
    log(`Bỏ qua, không tạo slug: ${failed}  -> report này giữ URL UUID`);
    log("");
    log("Sample slug (10 đầu):");
    for (const c of free.slice(0, 10)) log(`  ${c.id} -> ${c.slug}`);
    if (blocked > 0) {
      log("");
      log("Sẽ bị chặn (giữ NULL -> URL UUID):");
      for (const c of cands.filter((x) => taken.has(x.slug) || dupInBatch.has(x.slug)).slice(0, 10)) {
        const why = taken.has(c.slug) ? "đã có trong DB" : "trùng trong lô";
        log(`  ${c.id} -> ${c.slug}  [${why}]`);
      }
    }
    log("");
    return;
  }

  for (const c of cands) {
    if (taken.has(c.slug)) {
      collide += 1;
      log(`  [trùng slug, đã có trong DB] giữ NULL, dùng URL UUID: ${c.id}`);
      continue;
    }
    if (dupInBatch.has(c.slug) && owner.get(c.slug) !== c.id) {
      collide += 1;
      log(`  [trùng slug, trong lô] giữ NULL, dùng URL UUID: ${c.id}`);
      continue;
    }

    // `.is("seo_slug", null)` là chốt chặn overwrite: select ở trên có thể
    // cũ, ai đó gán slug giữa lúc select và lúc update. Không có điều kiện
    // này thì UPDATE vô điều kiện sẽ đè mất slug đã có.
    const { error: upErr } = await supabase
      .from("checks")
      .update({ seo_slug: c.slug })
      .eq("id", c.id)
      .is("seo_slug", null);
    if (upErr) {
      if (upErr.code === "23505") {
        // UNIQUE: 2 report trùng slug. Report này giữ NULL -> URL UUID
        // vẫn mở, không mất dữ liệu.
        collide += 1;
        log(`  [trùng slug] giữ NULL, dùng URL UUID: ${c.id}`);
      } else {
        failed += 1;
        log(`  [lỗi] ${c.id} code=${upErr.code ?? "unknown"}`);
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
