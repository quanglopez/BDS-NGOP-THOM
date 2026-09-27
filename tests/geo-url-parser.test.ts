// Self-check: lấy ward/region từ URL nhà tốt + thứ tự ưu tiên nguồn địa lý.
// Chạy: npm test — hàm thuần, không mạng.
import { strict as assert } from "node:assert";
import {
  normalizePlace,
  parseListingLocation,
  resolveListingGeo,
  type KnownArea,
} from "../lib/geo/url-parser.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e: Error) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

// Danh sách tên đã biết — giả lập dữ liệu đã crawl trong market_listings
const KNOWN: KnownArea[] = [
  { name: "Quận 6", isRegion: false },
  { name: "Phường 13", isRegion: false },
  { name: "Bình Thạnh", isRegion: false },
  { name: "Tp Hồ Chí Minh", isRegion: true },
  { name: "Vũng Tàu", isRegion: true },
];

async function main() {
  console.log("\n== normalizePlace ==");

  await check("bỏ dấu, ký tự lạ -> dạng slug", () => {
    assert.equal(normalizePlace("Quận 6"), "quan-6");
    assert.equal(normalizePlace("Tp Hồ Chí Minh"), "tp-ho-chi-minh");
    assert.equal(normalizePlace("Phường Phú Lâm"), "phuong-phu-lam");
  });

  console.log("\n== URL có ward + region rõ ràng -> PASS ==");

  await check("tách được khi slug khớp tên đã biết", () => {
    const r = parseListingLocation(
      "https://www.nhatot.com/mua-ban-nha-dat-quan-6-tp-ho-chi-minh/129990005.htm",
      KNOWN,
    );
    assert.equal(r.ward_name, "Quận 6");
    assert.equal(r.region_name, "Tp Hồ Chí Minh");
    assert.equal(r.confidence, "high");
  });

  await check("tách được cả khi ward nhiều từ", () => {
    const known: KnownArea[] = [...KNOWN, { name: "Phường Phú Lâm", isRegion: false }];
    const r = parseListingLocation(
      "https://www.nhatot.com/mua-ban-nha-dat-phuong-phu-lam-tp-ho-chi-minh/123.htm",
      known,
    );
    assert.equal(r.ward_name, "Phường Phú Lâm");
    assert.equal(r.region_name, "Tp Hồ Chí Minh");
    assert.equal(r.confidence, "high");
  });

  await check("URL 3 tầng (không đúng format) -> null, KHÔNG đoán", () => {
    // Format thật chỉ có 2 tầng: {ward}-{region}. URL 3 tầng là dữ liệu bẩn.
    const r = parseListingLocation(
      "https://www.nhatot.com/mua-ban-nha-dat-phuong-13-quan-6-tp-ho-chi-minh/1.htm",
      KNOWN,
    );
    assert.equal(r.ward_name, null);
    assert.equal(r.region_name, null);
  });

  await check("tỉnh 1 từ vẫn tách được", () => {
    const r = parseListingLocation("https://www.nhatot.com/mua-ban-nha-dat-quan-6-vung-tau/1.htm", KNOWN);
    assert.equal(r.ward_name, "Quận 6");
    assert.equal(r.region_name, "Vũng Tàu");
  });

  console.log("\n== URL thiếu slug -> null, không đoán ==");

  await check("dạng /tin/{id}.htm không mang địa lý", () => {
    const r = parseListingLocation("https://www.nhatot.com/tin/129990005.htm", KNOWN);
    assert.equal(r.ward_name, null);
    assert.equal(r.region_name, null);
    assert.equal(r.confidence, null);
  });

  await check("dạng /mua-ban-nha-dat/{id}.htm không có slug", () => {
    const r = parseListingLocation("https://www.nhatot.com/mua-ban-nha-dat/123.htm", KNOWN);
    assert.equal(r.ward_name, null);
    assert.equal(r.region_name, null);
  });

  await check("slug có nhưng chưa có tên đã biết -> KHÔNG đoán", () => {
    const r = parseListingLocation(
      "https://www.nhatot.com/mua-ban-nha-dat-quan-99-tp-khong-co-that/1.htm",
      KNOWN,
    );
    assert.equal(r.ward_name, null, "không được tự tách khi không có tên đối chiếu");
    assert.equal(r.region_name, null);
    assert.equal(r.confidence, "low");
  });

  await check("không truyền knownAreas -> không đoán", () => {
    const r = parseListingLocation("https://www.nhatot.com/mua-ban-nha-dat-quan-6-tp-ho-chi-minh/1.htm");
    assert.equal(r.ward_name, null);
    assert.equal(r.confidence, "low");
  });

  console.log("\n== URL format lạ / hỏng -> KHÔNG throw ==");

  await check("URL hỏng, rỗng, null, không phải URL", () => {
    for (const v of ["", "   ", "không-phải-url", "://x", null, undefined, 123 as never]) {
      const r = parseListingLocation(v, KNOWN);
      assert.equal(r.ward_name, null);
      assert.equal(r.confidence, null);
    }
  });

  await check("domain lạ -> bỏ qua (không đoán)", () => {
    const r = parseListingLocation("https://example.com/mua-ban-nha-dat-quan-6-tp-ho-chi-minh/1.htm", KNOWN);
    assert.equal(r.ward_name, null);
  });

  await check("format mới lạ -> trả null, không throw", () => {
    const r = parseListingLocation("https://www.nhatot.com/bai-dang-moi/khu-vuc-moi/1.htm", KNOWN);
    assert.equal(r.ward_name, null);
    assert.equal(r.confidence, null);
  });

  await check("path rỗng -> null", () => {
    const r = parseListingLocation("https://www.nhatot.com/", KNOWN);
    assert.equal(r.ward_name, null);
  });

  console.log("\n== Thứ tự ưu tiên nguồn địa lý ==");

  await check("1) scan thắng URL", () => {
    const g = resolveListingGeo({
      scanWard: "Quận 6",
      scanRegion: "Tp Hồ Chí Minh",
      listingUrl: "https://www.nhatot.com/mua-ban-nha-dat-quan-6-vung-tau/1.htm",
      knownAreas: KNOWN,
    });
    assert.equal(g.ward_name, "Quận 6");
    assert.equal(g.ward_source, "scan");
    assert.equal(g.region_name, "Tp Hồ Chí Minh");
    assert.equal(g.region_source, "scan");
  });

  await check("2) không có scan -> dùng URL, source='url'", () => {
    const g = resolveListingGeo({
      listingUrl: "https://www.nhatot.com/mua-ban-nha-dat-quan-6-tp-ho-chi-minh/1.htm",
      knownAreas: KNOWN,
    });
    assert.equal(g.ward_name, "Quận 6");
    assert.equal(g.ward_source, "url");
    assert.equal(g.region_source, "url");
  });

  await check("3) không xác định được -> null, fallback tỉnh", () => {
    const g = resolveListingGeo({ listingUrl: "https://www.nhatot.com/tin/1.htm", knownAreas: KNOWN });
    assert.equal(g.ward_name, null);
    assert.equal(g.region_name, null);
    assert.equal(g.ward_source, null);
    assert.equal(g.region_source, null);
  });

  await check("scan chỉ có ward -> region null, nguồn từng phần đúng", () => {
    const g = resolveListingGeo({ scanWard: "Quận 6", scanRegion: null });
    assert.equal(g.ward_name, "Quận 6");
    assert.equal(g.ward_source, "scan");
    assert.equal(g.region_name, null);
    assert.equal(g.region_source, null);
  });

  await check("chuỗi rỗng ở scan không được che mất URL", () => {
    const g = resolveListingGeo({
      scanWard: "   ",
      scanRegion: "",
      listingUrl: "https://www.nhatot.com/mua-ban-nha-dat-quan-6-tp-ho-chi-minh/1.htm",
      knownAreas: KNOWN,
    });
    assert.equal(g.ward_source, "url", "scan rỗng phải rơi xuống URL");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
