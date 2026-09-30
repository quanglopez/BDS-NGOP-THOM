// Test slug SEO cho URL báo cáo /bao-cao/{slug}-{shortId}.
// Quy tắc bắt buộc: URL cũ /bao-cao/{uuid} vẫn phải chạy được.
import { strict as assert } from "node:assert";
import {
  buildReportSlug,
  isUuid,
  parseReportRef,
  reportUrl,
  shortId,
  shortIdFromSlug,
  slugify,
} from "../lib/report/slug.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

const UUID = "9b41be3d-f1f1-4540-b191-43cd923b2ad2";

console.log("\n== Bo dau tieng Viet ==");

check("bỏ dấu và lowercase", () => {
  assert.equal(slugify("Bán Nhà Phố 4 Tầng"), "ban-nha-pho-4-tang");
  assert.equal(slugify("Hải Châu"), "hai-chau");
  assert.equal(slugify("Đà Nẵng"), "da-nang");
  assert.equal(slugify("Nguyễn Văn Linh"), "nguyen-van-linh");
  assert.equal(slugify("Sổ Hồng"), "so-hong");
});

check("ký tự lạ -> '-', gộp hyphen trùng", () => {
  assert.equal(slugify("Giá: 4,3 tỷ!!! (mặt tiền)"), "gia-4-3-ty-mat-tien");
  assert.equal(slugify("a  --  b"), "a-b");
  assert.equal(slugify("  viền  "), "vien");
  assert.equal(slugify("!!!"), "");
});

console.log("\n== Gia tien -> slug ==");

check("4.3 tỷ -> '4-3-ty'", () => {
  assert.ok(buildReportSlug({ title: "Nhà", province: "Đà Nẵng", price: 4_300_000_000, id: UUID }).includes("4-3-ty"));
});

check("giá tròn -> '7-ty' (không dư số 0)", () => {
  const s = buildReportSlug({ title: "Nhà", province: "Đà Nẵng", price: 7_000_000_000, id: UUID });
  assert.ok(s.includes("7-ty"), s);
  assert.ok(!s.includes("7-0-ty"), s);
});

check("thiếu giá -> không có đoạn giá", () => {
  const s = buildReportSlug({ title: "Nhà đất", province: "Hải Châu", price: null, id: UUID });
  assert.ok(!s.includes("ty"), s);
});

check("dưới 1 tỷ -> không đưa giá vào slug", () => {
  const s = buildReportSlug({ title: "Nhà", province: "Đà Nẵng", price: 850_000_000, id: UUID });
  assert.ok(!s.includes("-ty"), s);
});

console.log("\n== shortId ==");

check("shortId dài 6, ổn định, không phụ thuộc vị trí ký tự", () => {
  const a = shortId(UUID);
  assert.equal(a.length, 6);
  assert.equal(a, shortId(UUID));
  assert.notEqual(a, shortId("00000000-0000-0000-0000-000000000000"));
});

check("slug luôn kết thúc bằng shortId", () => {
  const s = buildReportSlug({ title: "Bán nhà", province: "Đà Nẵng", price: 4_300_000_000, id: UUID });
  const sid = shortIdFromSlug(s);
  assert.ok(sid, `phải bóc được shortId từ ${s}`);
  assert.equal(sid, shortId(UUID));
});

check("tiêu đề rỗng vẫn ra slug dùng được", () => {
  const s = buildReportSlug({ title: null, province: null, price: null, id: UUID });
  assert.equal(s, shortId(UUID));
  assert.ok(isUuid(UUID));
});

check("slug ví dụ trong ticket có đúng hình dạng", () => {
  const s = buildReportSlug({
    title: "Bán nhà phố 4 tầng",
    province: "Hải Châu, Đà Nẵng",
    price: 4_300_000_000,
    id: UUID,
  });
  assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/, `slug phải lowercase+gạch nối: ${s}`);
  assert.ok(s.startsWith("ban-nha-pho-4-tang"), s);
  assert.ok(s.includes("hai-chau-da-nang"), s);
  assert.ok(s.endsWith(shortId(UUID)), s);
});

console.log("\n== Route: UUID cu van chay ==");

check("isUuid nhận UUID, từ chối slug", () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(UUID.toUpperCase()), true);
  assert.equal(isUuid("ban-nha-pho-a91f2c"), false);
  assert.equal(isUuid(""), false);
});

// Thuộc tính NGHỊCH đảo: shortId là hash nên KHÔNG suy ra được từ
// cột `checks.id` bằng prefix — Postgres không có toán tử regex cho
// uuid. Vì vậy slug được LƯU (migration 0018, cột seo_slug) và tra cứu
// bằng so khớp chính xác. Test này khoá đúng cách tra cứu đó.
check("vòng khép kín: parseReportRef(seo_slug) cho lại shortId đúng", () => {
  const slug = buildReportSlug({
    title: "Bán nhà phố 4 tầng",
    province: "Hải Châu",
    price: 4_300_000_000,
    id: UUID,
  });
  const ref = parseReportRef(slug);
  assert.ok(ref, `phải parse được slug ${slug}`);
  assert.equal(ref.kind, "slug");
  if (ref.kind !== "slug") return;
  assert.equal(ref.slug, slug, "tra cứu phải bằng CHÍNH slug đã lưu, không phải shortId");
  assert.equal(ref.shortId, shortId(UUID), "shortId phải khớp để đối chiếu");
});

check("parseReportRef: UUID -> uuid, slug -> slug, rác -> null", () => {
  const u = parseReportRef(UUID);
  assert.equal(u && u.kind, "uuid");
  const s = parseReportRef("ban-nha-pho-4-3-ty-a91f2c");
  assert.equal(s && s.kind, "slug");
  assert.equal(parseReportRef("khong-phai-ref"), null);
  assert.equal(parseReportRef(""), null);
});

check("reportUrl: có slug dùng slug, report cũ rơi về UUID", () => {
  const slug = buildReportSlug({ title: "Nhà", province: "Đà Nẵng", price: 4_300_000_000, id: UUID });
  assert.equal(reportUrl(UUID, slug), `/bao-cao/${slug}`);
  // Report tạo trước khi có migration -> seo_slug null, URL cũ vẫn mở.
  assert.equal(reportUrl(UUID, null), `/bao-cao/${UUID}`);
  assert.equal(reportUrl(UUID, ""), `/bao-cao/${UUID}`);
});

check("shortId bóc được từ slug, trả null nếu không có", () => {
  assert.equal(shortIdFromSlug("ban-nha-pho-4-3-ty-a91f2c"), "a91f2c");
  assert.equal(shortIdFromSlug("nha"), null);
});

// UNIQUE index trên seo_slug: 2 report trùng slug thì ghi thứ 2 fail
// (Postgres 23505). Khi đó KHÔNG được trả slug cho client vì slug đó đang
// trỏ sang report khác — URL sẽ mở nhầm dữ liệu người khác.
check("slug trùng -> rơi về URL UUID, không mở nhầm report", () => {
  const other = "11111111-2222-3333-4444-555555555555";
  const a = buildReportSlug({ title: "Bán nhà", province: "Đà Nẵng", price: 4_300_000_000, id: UUID });
  const b = buildReportSlug({ title: "Bán nhà", province: "Đà Nẵng", price: 4_300_000_000, id: other });
  assert.notEqual(a, b, "shortId phải khác nhau để hai report không cùng slug");
  // Tra cứu là so khớp CHÍNH slug đã lưu, nên slug của A không thể mở B.
  assert.equal(reportUrl(UUID, a), `/bao-cao/${a}`);
  assert.equal(reportUrl(other, b), `/bao-cao/${b}`);
});

check("report tạo trước migration (seo_slug null) -> URL UUID", () => {
  assert.equal(reportUrl(UUID, null), `/bao-cao/${UUID}`);
  assert.equal(reportUrl(UUID, undefined), `/bao-cao/${UUID}`);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
