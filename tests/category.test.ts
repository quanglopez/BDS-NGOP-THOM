// Self-check: quét danh mục Chợ Tốt/Nhà Tốt. Chạy: npm test
// Chỉ test thuần (phân tích slug, lọc tin, ghép payload) — không gọi mạng.

import { strict as assert } from "node:assert";
import { parseCategoryUrl, stripAdminPrefix } from "../lib/category-slug.ts";
import {
  normalizeScanFilters,
  itemMatchesFilters,
  hasScanFilters,
  buildListingUrl,
  type CategoryItem,
} from "../lib/chotot-category.ts";

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

async function main() {
  console.log("\n== Phân tích URL danh mục ==");

  await check("nhà đất Gò Vấp TP.HCM", () => {
    const r = parseCategoryUrl(
      "https://www.nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh",
    );
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "nha-dat");
    assert.equal(r!.wardSlug, "quan-go-vap");
    assert.equal(r!.provinceName, "TP.HCM");
  });

  await check("nhà ở có dấu, quận Hà Nội", () => {
    const r = parseCategoryUrl("https://www.nhatot.com/mua-ban-nha-o-quan-cau-giay-ha-noi");
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "nha-o");
    assert.equal(r!.wardSlug, "quan-cau-giay");
    assert.equal(r!.provinceName, "Hà Nội");
  });

  await check("đất nền cấp tỉnh (không có quận)", () => {
    const r = parseCategoryUrl("https://www.chotot.com/mua-ban-dat-nen-da-nang");
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "dat");
    assert.equal(r!.wardSlug, null);
    assert.equal(r!.provinceName, "Đà Nẵng");
  });

  await check("căn hộ Vũng Tàu", () => {
    const r = parseCategoryUrl("https://www.nhatot.com/mua-ban-can-ho-chung-cu-vung-tau");
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "can-ho");
    assert.equal(r!.provinceName, "Vũng Tàu");
  });

  await check("URL tin chi tiết -> null (đi đường extract)", () => {
    assert.equal(
      parseCategoryUrl("https://www.nhatot.com/mua-ban-nha-dat/134384271.htm"),
      null,
    );
  });

  await check("host lạ -> null", () => {
    assert.equal(parseCategoryUrl("https://batdongsan.com.vn/nha-dat-ban"), null);
    assert.equal(parseCategoryUrl("not-a-url"), null);
  });

  await check("slug không rõ loại -> null", () => {
    assert.equal(parseCategoryUrl("https://www.nhatot.com/tin-tuc-bat-dong-san"), null);
  });

  console.log("\n== Tiện ích slug ==");

  await check("lột tiền tố hành chính", () => {
    assert.equal(stripAdminPrefix("quan-go-vap"), "go-vap");
    assert.equal(stripAdminPrefix("thanh-pho-vung-tau"), "vung-tau");
    assert.equal(stripAdminPrefix("thuy-van"), "thuy-van");
  });

  console.log("\n== Bộ lọc quét (giá, diện tích, phòng) ==");

  await check("filter rỗng -> null", () => {
    assert.equal(normalizeScanFilters({}), null);
    assert.equal(normalizeScanFilters(null), null);
    assert.equal(normalizeScanFilters({ priceMin: 0, areaMin: -5 }), null);
    assert.equal(hasScanFilters(null), false);
  });

  await check("chuẩn hóa số, bỏ giá trị rỗng, hoán min/max", () => {
    const f = normalizeScanFilters({ priceMin: "5", priceMax: "2", areaMin: "3,5", minRooms: "3" });
    assert.ok(f);
    assert.equal(f!.priceMin, 2);
    assert.equal(f!.priceMax, 5);
    assert.equal(f!.areaMin, 3.5);
    assert.equal(f!.minRooms, 3);
    assert.equal(hasScanFilters(f), true);
  });

  await check("chặn ngưỡng bừa (giá > 1000 tỷ, dt > 10.000 m²)", () => {
    const f = normalizeScanFilters({ priceMax: 5000, areaMax: 20000 });
    assert.ok(f);
    assert.equal(f!.priceMax, 1000);
    assert.equal(f!.areaMax, 10000);
  });

  const mk = (p: Partial<CategoryItem>): CategoryItem => ({
    id: "1",
    url: "https://x/1",
    title: "t",
    text: "t".repeat(120),
    priceHint: null,
    areaHint: null,
    price: null,
    size: null,
    rooms: null,
    ward: "w",
    region: "r",
    image: null,
    ...p,
  });

  await check("URL tin thật dựng đúng định dạng nhatot", () => {
    // Định dạng chuẩn đã kiểm chứng: /mua-ban-nha-dat-{quận}-{tỉnh}/{id}.htm
    const r = buildListingUrl("134384271", "Quận Gò Vấp", "Tp Hồ Chí Minh");
    assert.equal(
      r,
      "https://www.nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh/134384271.htm",
    );
  });

  await check("URL tin thật thiếu tên thì vẫn ra đuôi id.htm", () => {
    const r = buildListingUrl("134384271", "", "");
    assert.equal(r, "https://www.nhatot.com/mua-ban-nha-dat/134384271.htm");
  });

  await check("lọc theo khoảng giá (đơn vị tỷ, giá VND)", () => {
    const f = normalizeScanFilters({ priceMin: 2, priceMax: 5 });
    assert.ok(itemMatchesFilters(mk({ price: 3_500_000_000 }), f!));
    assert.ok(!itemMatchesFilters(mk({ price: 1_000_000_000 }), f!));
    assert.ok(!itemMatchesFilters(mk({ price: 7_000_000_000 }), f!));
  });

  await check("lọc theo khoảng diện tích", () => {
    const f = normalizeScanFilters({ areaMin: 50, areaMax: 100 });
    assert.ok(itemMatchesFilters(mk({ size: 80 }), f!));
    assert.ok(!itemMatchesFilters(mk({ size: 30 }), f!));
    assert.ok(!itemMatchesFilters(mk({ size: 150 }), f!));
  });

  await check("lọc số phòng ngủ là tối thiểu", () => {
    const f = normalizeScanFilters({ minRooms: 3 });
    assert.ok(itemMatchesFilters(mk({ rooms: 5 }), f!));
    assert.ok(itemMatchesFilters(mk({ rooms: 3 }), f!));
    assert.ok(!itemMatchesFilters(mk({ rooms: 2 }), f!));
  });

  await check("tin thiếu giá/diện tích/phòng bị loại khi có filter tương ứng", () => {
    assert.ok(!itemMatchesFilters(mk({}), normalizeScanFilters({ priceMin: 1 })!));
    assert.ok(!itemMatchesFilters(mk({}), normalizeScanFilters({ areaMax: 100 })!));
    assert.ok(!itemMatchesFilters(mk({}), normalizeScanFilters({ minRooms: 2 })!));
    // Không có filter thì tin thiếu số vẫn qua
    assert.ok(itemMatchesFilters(mk({}), {}));
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
