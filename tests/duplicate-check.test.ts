// So sánh 2 tin BĐS (PHASE 7) — test hành vi + tường lửa tĩnh.
//
// Trọng tâm bảo vệ:
// - Bằng chứng giống nhau KHÔNG PHẢI khẳng định cùng một tài sản.
// - Chênh lệch giá KHÔNG PHẢI khẳng định giá sai.
// - Điện thoại/URL không bao giờ là bằng chứng.
// - Thuần máy: không fetch, không DB, không localStorage, không quota.
// - Trích dẫn là NGUYÊN VĂN từ input (giữ dấu và hoa/thường).
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  MAX_TEXT_LENGTH,
  MIN_TEXT_LENGTH,
  compareDuplicate,
  type DuplicateCheckResult,
} from "../lib/duplicate-check/compare.ts";
import {
  formatVndShort,
  parseListingPrice,
  parseNumberToken,
  pctText,
} from "../lib/duplicate-check/prices.ts";
import {
  BANNER_TEXT,
  CHECKLIST,
  CROSS_TOOL,
  FORBIDDEN_CLAIMS,
  LEVEL_LABEL,
  LIMITATION,
  NEGATION_MARKERS,
  NEGATION_ONLY_CLAIMS,
  PRICE_EQUAL_TEXT,
  PRICE_HEADING,
  PRICE_UNAVAILABLE_NOTE,
} from "../lib/duplicate-check/wording.ts";

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

const CLIENT_SRC = "components/duplicate-check/duplicate-check-client.tsx";
const PAGE_SRC = "app/tools/so-sanh-hai-tin-bds/page.tsx";
const LIB_DIR = "lib/duplicate-check";

function run(textA: string, textB: string): DuplicateCheckResult {
  const r = compareDuplicate({ textA, textB });
  assert.ok(r, `phải so sánh được: ${textA.slice(0, 24)}...`);
  return r;
}

/** Mọi chuỗi kết quả, trừ phần giá (giá được phép có % theo hợp đồng). */
function resultStrings(r: DuplicateCheckResult): { all: string[]; nonPrice: string[] } {
  const nonPrice = [
    r.levelLabel,
    r.explanation,
    r.limitation,
    ...(r.banner ? [r.banner] : []),
    ...r.shared.map((s) => s.text),
    ...r.contradictions.map((c) => c.text),
    ...r.checklist,
  ];
  return { all: [...nonPrice, ...r.price.lines], nonPrice };
}

/**
 * Guard claim 2 tầng:
 *  1. FORBIDDEN_CLAIMS — cấm tuyệt đối.
 *  2. NEGATION_ONLY_CLAIMS — chỉ cho khi bị phủ định trước, hoặc là câu hỏi
 *     phủ định ("... không?"). Cần tầng 2 vì câu giới hạn năng lực và FAQ nêu
 *     tên điều chúng bác bỏ.
 */
function assertNoForbidden(strings: string[], where: string) {
  for (const text of strings) {
    const lower = text.toLowerCase();
    for (const claim of FORBIDDEN_CLAIMS) {
      assert.equal(
        lower.includes(claim.toLowerCase()),
        false,
        `${where}: không được chứa "${claim}" — gặp trong: ${text}`,
      );
    }
    for (const claim of NEGATION_ONLY_CLAIMS) {
      const needle = claim.toLowerCase();
      let from = 0;
      for (;;) {
        const at = lower.indexOf(needle, from);
        if (at === -1) break;
        from = at + needle.length;
        const before = lower.slice(Math.max(0, at - 40), at);
        const after = lower.slice(at + needle.length, at + needle.length + 15);
        const negated =
          NEGATION_MARKERS.some((n) => before.includes(n)) || after.includes("không");
        assert.ok(
          negated,
          `${where}: "${claim}" chỉ được nói dưới dạng phủ định — gặp khẳng định: ${text}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- fixtures

const CASE_A_A =
  "Căn hộ Vinhomes Grand Park 68m2 2 phòng ngủ, view sông tầng trung, giá 4,8 tỷ.";
const CASE_A_B =
  "Căn hộ Vinhomes Grand Park 68 m² 2 phòng ngủ, view sông tầng trung, giá 5,2 tỷ.";

const TOWER_A =
  "Căn hộ Vinhomes Grand Park, tòa S1, 68m2, 2 phòng ngủ, view sông, giá 4,8 tỷ.";
const TOWER_B =
  "Căn hộ Vinhomes Grand Park, tòa S2, 68m2, 2 phòng ngủ, view sông, giá 4,8 tỷ.";

const PROV_A = "Nhà 68m2 giá 4,8 tỷ ở Đà Nẵng, sổ hồng riêng, cần bán gấp.";
const PROV_B = "Nhà 68m2 giá 4,8 tỷ ở Hà Nội, sổ hồng riêng, cần bán gấp.";

// ------------------------------------------------------------------ PRICE

console.log("\n== price parser ==");

check("1. '4,8 tỷ' -> total 4.800.000.000, quote nguyên văn", () => {
  const p = parseListingPrice("Nhà đẹp, giá 4,8 tỷ, cần bán gấp.");
  assert.equal(p.kind, "total");
  if (p.kind !== "total") return;
  assert.equal(p.valueVnd, 4_800_000_000);
  assert.equal(p.quote, "4,8 tỷ");
});

check("2. '4.8 tỷ' -> total 4.800.000.000", () => {
  const p = parseListingPrice("Giá 4.8 tỷ chốt nhanh.");
  assert.equal(p.kind, "total");
  assert.equal(p.kind === "total" ? p.valueVnd : 0, 4_800_000_000);
});

check("3. '4800 triệu' -> total 4.800.000.000", () => {
  const p = parseListingPrice("Bán nhà 4800 triệu, sổ riêng.");
  assert.equal(p.kind === "total" ? p.valueVnd : 0, 4_800_000_000);
});

check("4. '1.200 triệu' -> 1.200 trieu = 1.200.000.000 (nhóm 3 số = nghìn)", () => {
  const p = parseListingPrice("Bán căn 1.200 triệu, cần tiền.");
  assert.equal(p.kind === "total" ? p.valueVnd : 0, 1_200_000_000);
});

check("5. '1,2 tỷ' -> total 1.200.000.000", () => {
  const p = parseListingPrice("Bán đất 1,2 tỷ, sổ hồng riêng.");
  assert.equal(p.kind === "total" ? p.valueVnd : 0, 1_200_000_000);
});

check("6. '4 tỷ 800' -> 4 tỷ + 800 triệu = 4.800.000.000", () => {
  const p = parseListingPrice("Nhà cần bán gấp, giá 4 tỷ 800, sổ riêng.");
  assert.equal(p.kind, "total");
  if (p.kind !== "total") return;
  assert.equal(p.valueVnd, 4_800_000_000);
  assert.equal(p.quote, "4 tỷ 800");
});

check("7. '80 triệu/m²' -> per_m2, KHÔNG phải total", () => {
  const p = parseListingPrice("Đất 80 triệu/m², vị trí đẹp.");
  assert.equal(p.kind, "per_m2");
  assert.equal(p.kind === "per_m2" ? p.valueVndPerM2 : 0, 80_000_000);
  if (p.kind === "per_m2") assert.equal(p.quote, "80 triệu/m²");
});

check("8. '4-5 tỷ' -> range 4-5 tỷ", () => {
  const p = parseListingPrice("Nhà giá 4-5 tỷ, thương lượng.");
  assert.equal(p.kind, "range");
  if (p.kind !== "range") return;
  assert.equal(p.minVnd, 4_000_000_000);
  assert.equal(p.maxVnd, 5_000_000_000);
});

check("9. '4,8–5 tỷ' -> range 4,8-5 tỷ", () => {
  const p = parseListingPrice("Căn hộ giá 4,8–5 tỷ cần bán nhanh.");
  assert.equal(p.kind, "range");
  if (p.kind !== "range") return;
  assert.equal(p.minVnd, 4_800_000_000);
  assert.equal(p.maxVnd, 5_000_000_000);
});

check("10. nhiều total khác nhau -> ambiguous, không tự chọn", () => {
  const p = parseListingPrice("Giá 4,8 tỷ, còn thương lượng từ 5,2 tỷ.");
  assert.equal(p.kind, "ambiguous");
});

check("11. 'giá 4x tỷ' -> none", () => {
  assert.equal(parseListingPrice("giá 4x tỷ").kind, "none");
  assert.equal(parseListingPrice("Nhà 68m2 2pn đẹp").kind, "none");
});

check("11b. parseNumberToken: thập phân vs nhóm nghìn vs từ chối", () => {
  assert.equal(parseNumberToken("4800"), 4800);
  assert.equal(parseNumberToken("4,8"), 4.8);
  assert.equal(parseNumberToken("4.8"), 4.8);
  assert.equal(parseNumberToken("1.200"), 1200);
  assert.equal(parseNumberToken("4,800"), 4800);
  assert.equal(parseNumberToken("1.200.000"), 1200000);
  assert.equal(parseNumberToken("1,25"), 1.25);
  assert.equal(parseNumberToken("1.2000"), null);
  assert.equal(parseNumberToken("4x"), null);
});

check("11c. formatVndShort + pctText", () => {
  assert.equal(formatVndShort(400_000_000), "400 triệu");
  assert.equal(formatVndShort(1_400_000_000), "1,4 tỷ");
  assert.equal(formatVndShort(4_800_000_000), "4,8 tỷ");
  assert.equal(pctText(4_800_000_000, 5_200_000_000), "8,0");
});

// ------------------------------------------------------------- SIMILARITY

console.log("\n== similarity ==");

check("12. tin copy y hệt -> HIGH, có dự án/diện tích/phòng ngủ/cụm mô tả", () => {
  const r = run(CASE_A_A, CASE_A_A);
  assert.equal(r.level, "high");
  assert.ok(r.shared.some((s) => s.kind === "project"));
  assert.ok(r.shared.some((s) => s.kind === "area"));
  assert.ok(r.shared.some((s) => s.kind === "bedrooms"));
  assert.ok(r.shared.some((s) => s.kind === "text_span"));
  assert.equal(r.contradictions.length, 0);
});

check("13. biến thể dấu câu -> vẫn nhận (token-based)", () => {
  const a = "Căn hộ Vinhomes Grand Park 68m2 2 phòng ngủ view sông tầng trung giá 4,8 tỷ.";
  const b = "Căn hộ Vinhomes Grand Park, 68m2. 2 phòng ngủ... view sông tầng trung; giá 4,8 tỷ!";
  const r = run(a, b);
  assert.equal(r.level, "high");
});

check("14. biến thể dấu tiếng Việt -> vẫn nhận, quote mỗi bên theo bản gốc", () => {
  const b =
    "Can ho Vinhomes Grand Park 68m2 2 phong ngu, view song tang trung, gia 5,2 ty.";
  const r = run(CASE_A_A, b);
  assert.equal(r.level, "high");
  assert.ok(r.shared.some((s) => s.text.includes("Vinhomes Grand Park")));
  const priceLines = r.price.lines.join(" ");
  assert.ok(priceLines.includes("5,2 ty"), "quote Tin B phải nguyên văn bản không dấu");
});

check("15. cùng dự án+diện tích+phòng ngủ nhưng khác tòa -> LOW + banner", () => {
  const r = run(TOWER_A, TOWER_B);
  assert.equal(r.level, "low");
  assert.equal(r.banner, BANNER_TEXT);
  assert.ok(r.contradictions.some((c) => c.text.includes("S1") && c.text.includes("S2")));
  // Bằng chứng giống vẫn hiển thị — nhưng mức bị mâu thuẫn lớn ép xuống.
  assert.ok(r.shared.some((s) => s.kind === "project"));
});

check("16. cùng diện tích + cùng giá, khác tỉnh -> LOW + banner", () => {
  const r = run(PROV_A, PROV_B);
  assert.equal(r.level, "low");
  assert.equal(r.banner, BANNER_TEXT);
  assert.ok(r.contradictions.some((c) => c.text.includes("Đà Nẵng") && c.text.includes("Hà Nội")));
  assert.ok(r.price.lines.includes(PRICE_EQUAL_TEXT));
});

check("17. cùng SĐT, tin khác nhau -> điện thoại đóng góp 0", () => {
  const a = "Nhà phố 3 tầng mới ở Đà Nẵng, liên hệ 0905 123 456, giá 3 tỷ.";
  const b = "Đất nền 150m2 ở Đà Nẵng, liên hệ 0905 123 456, giá 2 tỷ.";
  const r = run(a, b);
  const { all } = resultStrings(r);
  assert.equal(all.some((s) => s.includes("0905")), false, "số điện thoại không được xuất hiện");
  assert.equal(r.level, "low");
});

check("18. template quảng cáo chung -> LOW, không bằng chứng", () => {
  const a = "Nhà đẹp sổ hồng riêng, giá tốt, liên hệ ngay, chính chủ cần bán.";
  const b = "Đất đẹp sổ hồng riêng, giá tốt, liên hệ ngay, chính chủ cần bán.";
  const r = run(a, b);
  assert.equal(r.level, "low");
  assert.equal(r.shared.length, 0, "cụm quảng cáo chung không được là bằng chứng");
});

check("19. đổi giá một tin -> mức giống nhau KHÔNG đổi vì giá", () => {
  const withDiffPrice = run(CASE_A_A, CASE_A_B);
  const withSamePrice = run(CASE_A_A, CASE_A_A);
  assert.equal(withDiffPrice.level, withSamePrice.level);
  assert.equal(withDiffPrice.price.status, "compared");
  assert.equal(withSamePrice.price.status, "equal");
});

check("20. dải diện tích '62-82,5-105,5m2' -> không có bằng chứng diện tích", () => {
  const a = "Đất nền diện tích từ 62-82,5-105,5m2 tại Đà Nẵng, giá 4 tỷ.";
  const b = "Đất nền diện tích từ 62-82,5-105,5m2 tại Đà Nẵng, giá 4 tỷ.";
  const r = run(a, b);
  assert.equal(r.shared.some((s) => s.kind === "area"), false, "dải không được thành diện tích");
});

check("21. chênh 0,5 m² -> vẫn là M2 (<= 0,5)", () => {
  const r = run("Nhà 68m2 ở Đà Nẵng cần bán gấp.", "Nhà 68,5 m2 ở Đà Nẵng cần bán gấp.");
  const area = r.shared.find((s) => s.kind === "area");
  assert.ok(area, "phải có bằng chứng diện tích");
  assert.ok(area.text.includes("68 m²"));
  assert.ok(area.text.includes("68,5 m²"), "ghi rõ cách ghi của Tin B");
});

check("22. lệch diện tích > 20% -> mâu thuẫn lớn, LOW + banner", () => {
  const r = run(
    "Nhà phố 68m2 tại Đà Nẵng, sổ hồng riêng, cần bán gấp.",
    "Nhà phố 100m2 tại Đà Nẵng, sổ hồng riêng, cần bán gấp.",
  );
  assert.equal(r.level, "low");
  assert.equal(r.banner, BANNER_TEXT);
  assert.ok(r.contradictions.some((c) => c.text.includes("68") && c.text.includes("100")));
});

check("23. cùng số phòng ngủ -> M3", () => {
  const r = run(
    "Căn 2 phòng ngủ ở Đà Nẵng gần biển, nội thất mới.",
    "Nhà 2 phòng ngủ ở Đà Nẵng gần chợ, sân thượng.",
  );
  assert.ok(r.shared.some((s) => s.kind === "bedrooms" && s.text.includes("2 phòng ngủ")));
});

check("24. khác số phòng ngủ -> mâu thuẫn nhỏ, chặn HIGH", () => {
  const a = "Nhà 68m2 2 phòng ngủ ở Đà Nẵng, sân vườn rộng rãi trồng nhiều cây xanh mát.";
  const b = "Nhà 68m2 3 phòng ngủ ở Đà Nẵng, sân vườn rộng rãi trồng nhiều cây xanh mát.";
  const r = run(a, b);
  assert.equal(r.hasMinor, true);
  assert.equal(r.level, "medium", "mâu thuẫn nhỏ: tối đa MEDIUM");
  assert.equal(r.banner, BANNER_TEXT);
});

check("25. thiếu phòng ngủ một bên -> trung tính", () => {
  const r = run(
    "Nhà 68m2 ở Đà Nẵng, sân vườn rộng rãi trồng nhiều cây xanh mát.",
    "Nhà 68m2 3 phòng ngủ ở Đà Nẵng, sân vườn rộng rãi trồng nhiều cây xanh mát.",
  );
  assert.equal(r.shared.some((s) => s.kind === "bedrooms"), false);
  assert.equal(r.contradictions.some((c) => c.text.includes("phòng ngủ")), false);
});

check("26. dự án nhắc 3 lần -> vẫn chỉ MỘT đơn vị M1", () => {
  const a =
    "Dự án Vinhomes Grand Park. Vinhomes Grand Park 68m2. Dự án Vinhomes Grand Park 2pn.";
  const b = "Dự án Vinhomes Grand Park 70m2, 2 phòng ngủ, cần bán gấp.";
  const r = run(a, b);
  assert.equal(r.shared.filter((s) => s.kind === "project").length, 1);
});

check("27. cụm trùng lặp lại -> gộp, tối đa đóng góp có giới hạn", () => {
  const a = "Nhà có sân vườn rộng rãi trồng nhiều cây xanh mát, gần chợ lớn.";
  const b =
    "Nhà có sân vườn rộng rãi trồng nhiều cây xanh mát. Sân vườn rộng rãi trồng nhiều cây xanh mát.";
  const r = run(a, b);
  const spans = r.shared.filter((s) => s.kind === "text_span");
  assert.equal(spans.length, 1, "cùng nội dung chỉ đếm một lần");
});

check("28. cụm quảng cáo chung -> bị loại", () => {
  const r = run(
    "Nhà vị trí đẹp, sổ hồng riêng, cần bán gấp ở Đà Nẵng.",
    "Đất vị trí đẹp, sổ hồng riêng, cần bán gấp ở Đà Nẵng.",
  );
  assert.equal(r.shared.some((s) => s.kind === "text_span"), false);
});

check("29. cùng URL -> URL đóng góp 0, không xuất hiện trong kết quả", () => {
  const a = "Bán nhà https://batdongsan.com.vn/tin/123 tại Đà Nẵng, 68m2.";
  const b = "Bán đất https://batdongsan.com.vn/tin/123 tại Đà Nẵng, 68m2.";
  const r = run(a, b);
  const { all } = resultStrings(r);
  assert.equal(all.some((s) => s.includes("batdongsan")), false, "URL không được là bằng chứng");
  assert.equal(r.level, "low");
});

check("30. cùng SĐT (chữ số dính) -> vẫn 0", () => {
  const a = "Nhà phố Đà Nẵng gọi 0905123456, giá 3 tỷ, sổ riêng.";
  const b = "Căn hộ Đà Nẵng gọi 0905123456, giá 2 tỷ, nội thất.";
  const r = run(a, b);
  const { all } = resultStrings(r);
  assert.equal(all.some((s) => s.includes("0905123456")), false);
});

// ---------------------------------------------------------------- DECISION

console.log("\n== decision ==");

check("31. Count 0 -> LOW", () => {
  const r = run(
    "Nhà phố 3 tầng mới xây ở Đà Nẵng, nội thất cao cấp.",
    "Đất nền 150m2 gần biển ở Đà Nẵng, giá tốt.",
  );
  assert.equal(r.count, 0);
  assert.equal(r.level, "low");
});

check("32. Count 1 -> LOW", () => {
  const r = run("Nhà 68m2 ở Đà Nẵng, mới đẹp.", "Căn 68m2 ở Đà Nẵng, nội thất tốt.");
  assert.equal(r.shared.length, 1);
  assert.equal(r.shared[0].kind, "area");
  assert.equal(r.level, "low");
});

check("33. Count 2 không mâu thuẫn -> MEDIUM", () => {
  const r = run(
    "Nhà 68m2 2 phòng ngủ ở Đà Nẵng, hàng xóm thân thiện.",
    "Căn 68m2 2 phòng ngủ ở Đà Nẵng, khu dân trí cao.",
  );
  assert.ok(r.count >= 2);
  assert.equal(r.level, "medium");
  assert.equal(r.banner, null);
});

check("34. Count >=3 CÓ ngữ cảnh vị trí -> HIGH (case A)", () => {
  const r = run(CASE_A_A, CASE_A_B);
  assert.equal(r.level, "high");
  assert.ok(r.count >= 3);
  assert.ok(r.shared.some((s) => s.kind === "project"), "ngữ cảnh vị trí phải từ dự án");
});

check("35. Count >=3 KHÔNG có dự án/vị trí -> chỉ MEDIUM", () => {
  const a = "Nhà 68m2 2 phòng ngủ, có sân vườn rộng rãi trồng nhiều cây xanh mát.";
  const b = "Căn 68m2 2 phòng ngủ, có sân vườn rộng rãi trồng nhiều cây xanh mát.";
  const r = run(a, b);
  assert.ok(r.count >= 3, `count phải >=3, gặp ${r.count}`);
  assert.equal(r.level, "medium", "không có M1/M4 thì không được HIGH");
  assert.equal(r.shared.some((s) => s.kind === "project"), false);
  assert.equal(r.shared.some((s) => s.kind === "location_phrase"), false);
});

check("36. mâu thuẫn lớn -> luôn LOW dù bằng chứng nhiều", () => {
  const r = run(PROV_A, PROV_B);
  assert.equal(r.hasMajor, true);
  assert.equal(r.level, "low");
});

check("37. mâu thuẫn nhỏ -> tối đa MEDIUM, có banner", () => {
  const r = run(
    "Nhà 68m2 2 phòng ngủ ở Đà Nẵng, sân vườn rộng rãi trồng nhiều cây xanh mát.",
    "Nhà 68m2 3 phòng ngủ ở Đà Nẵng, sân vườn rộng rãi trồng nhiều cây xanh mát.",
  );
  assert.equal(r.level, "medium");
  assert.equal(r.banner, BANNER_TEXT);
});

check("38. chênh giá KHÔNG ảnh hưởng mức giống nhau", () => {
  const r1 = run(CASE_A_A, CASE_A_B);
  const r2 = run(CASE_A_A, CASE_A_A);
  assert.equal(r1.level, r2.level);
  assert.equal(r1.contradictions.length, r2.contradictions.length);
});

// ---------------------------------------------------------------- EVIDENCE

console.log("\n== evidence ==");

check("39. quote NGUYÊN VĂN từ bản gốc (giữ dấu)", () => {
  const r = run(CASE_A_A, CASE_A_B);
  const span = r.shared.find((s) => s.kind === "text_span");
  assert.ok(span, "phải có cụm mô tả");
  assert.ok(span.text.includes("phòng ngủ"), "quote giữ dấu tiếng Việt");
  assert.ok(span.text.includes("sông"));
});

check("40. giữ nguyên chữ HOA", () => {
  const a = "Căn hộ VINHOMES GRAND PARK 68m2 2 phòng ngủ, giá 4,8 tỷ.";
  const b = "Căn hộ VINHOMES GRAND PARK 68m2 2 phòng ngủ, giá 4,8 tỷ.";
  const r = run(a, b);
  const project = r.shared.find((s) => s.kind === "project");
  assert.ok(project?.text.includes("VINHOMES GRAND PARK"));
});

check("41. dấu câu xung quanh quote được làm sạch, không cắt mất chữ", () => {
  const r = run(CASE_A_A, CASE_A_B);
  const span = r.shared.find((s) => s.kind === "text_span");
  assert.ok(span);
  // Quote không được mở đầu/kết thúc bằng dấu câu rời.
  assert.ok(!/^[,.;:]/.test(span.text.replace(/^.*: “/, "")));
});

check("42. không render bản đã chuẩn hoá làm quote", () => {
  const r = run(CASE_A_A, CASE_A_B);
  for (const s of r.shared) {
    // Bản chuẩn hoá của "Vinhomes" là "vinhomes" — không được xuất hiện dạng quote.
    assert.equal(s.text.includes("“vinhomes"), false);
    assert.equal(s.text.includes("“can ho"), false);
  }
});

check("42b. 'gần dự án X' -> KHÔNG trích dự án (chỗ lân cận, không phải chỗ của tin)", () => {
  const a = "Nhà hẻm gần dự án Vinhomes Grand Park 68m2, giá 3 tỷ, sổ riêng.";
  const b = "Căn hẻm gần dự án Vinhomes Grand Park 68m2, giá 3 tỷ, sổ riêng.";
  const r = run(a, b);
  assert.equal(r.shared.some((s) => s.kind === "project"), false, "gần dự án không phải dự án của tin");
  assert.equal(r.shared.some((s) => s.kind === "area"), true);
});

check("42c. cùng cụm vị trí 'đường X' -> M4, chỉ là câu chữ", () => {
  const a = "Nhà 68m2 hướng đường Nguyễn Văn Linh, cần bán gấp, giá 3 tỷ.";
  const b = "Căn 68m2 hướng đường Nguyễn Văn Linh, nội thất mới, giá 3 tỷ.";
  const r = run(a, b);
  const loc = r.shared.find((s) => s.kind === "location_phrase");
  assert.ok(loc, "phải có M4");
  assert.ok(loc.text.includes("Nguyễn Văn Linh"));
  assert.ok(!loc.text.includes("đã kiểm chứng"), "không được gọi là địa chỉ đã kiểm chứng");
});

check("42d. khác cụm vị trí -> trung tính, không mâu thuẫn", () => {
  const a = "Nhà 68m2 đường Nguyễn Văn Linh, giá 3 tỷ, sổ riêng.";
  const b = "Nhà 68m2 đường Lê Lợi, giá 3 tỷ, sổ riêng.";
  const r = run(a, b);
  assert.equal(r.shared.some((s) => s.kind === "location_phrase"), false);
  assert.equal(r.contradictions.some((c) => c.text.includes("Nguyễn")), false);
});

check("42e. 'xa' không dấu (xa trung tâm) không phải 'xã'", () => {
  const a = "Nhà 68m2 xa trung tâm quận 1, giá 3 tỷ, sổ riêng đẹp.";
  const b = "Căn 68m2 xa trung tâm quận 1, giá 3 tỷ, nội thất đủ.";
  const r = run(a, b);
  assert.equal(r.shared.some((s) => s.kind === "location_phrase"), false);
});

// ------------------------------------------------------------ TRUTHFULNESS

console.log("\n== truthfulness ==");

check("43. mọi chuỗi kết quả sạch claim bị cấm (kể cả phủ định trái quy tắc)", () => {
  for (const [a, b] of [
    [CASE_A_A, CASE_A_B],
    [TOWER_A, TOWER_B],
    [PROV_A, PROV_B],
    ["Nhà vị trí đẹp, sổ hồng riêng, liên hệ ngay.", "Đất vị trí đẹp, sổ hồng riêng, liên hệ ngay."],
  ]) {
    const r = run(a, b);
    assertNoForbidden(resultStrings(r).all, `result(${a.slice(0, 14)})`);
  }
});

check("44. không có % hoặc match trong phần KHÔNG phải giá", () => {
  const r = run(CASE_A_A, CASE_A_B);
  for (const s of resultStrings(r).nonPrice) {
    assert.equal(s.includes("%"), false, `không được có % ngoài phần giá: ${s}`);
    assert.equal(/match/i.test(s), false);
  }
  // Phần giá thì ĐƯỢC có % theo hợp đồng.
  assert.ok(r.price.lines.some((l) => l.includes("%")), "phần giá phải có % chênh lệch");
});

check("45. limitation ĐÚNG CHÍNH XÃI, có trong mọi kết quả", () => {
  assert.equal(
    LIMITATION,
    "CheckBDS chỉ so sánh thông tin xuất hiện trong hai nội dung bạn dán. Kết quả không xác nhận hai tin là cùng một tài sản, không xác minh người đăng và không xác định giá thật của bất động sản.",
  );
  for (const [a, b] of [
    [CASE_A_A, CASE_A_B],
    ["Nhà 68m2 ở Đà Nẵng cần bán gấp.", "Căn 68m2 ở Đà Nẵng cần bán gấp."],
  ]) {
    assert.equal(run(a, b).limitation, LIMITATION);
  }
});

check("46. checklist ĐÚNG 7 câu cố định, đúng thứ tự", () => {
  assert.equal(CHECKLIST.length, 7);
  assert.equal(CHECKLIST[0], "Hai tin có cùng block/tòa/khu không?");
  assert.equal(CHECKLIST[3], "Mã căn/lô/thửa có trùng không?");
  assert.equal(CHECKLIST[6], "Đã đối chiếu trực tiếp giấy tờ và hiện trạng tài sản trước khi đặt cọc chưa?");
  const r = run(CASE_A_A, CASE_A_B);
  assert.deepEqual(r.checklist, [...CHECKLIST]);
});

check("47. nhãn mức ĐÚNG hợp đồng", () => {
  assert.equal(LEVEL_LABEL.high, "NHIỀU DẤU HIỆU GIỐNG NHAU");
  assert.equal(LEVEL_LABEL.medium, "CÓ MỘT SỐ DẤU HIỆU GIỐNG NHAU");
  assert.equal(LEVEL_LABEL.low, "CHƯA ĐỦ DỮ LIỆU ĐỂ SO SÁNH");
  assert.equal(PRICE_HEADING, "GIÁ NIÊM YẾT TRONG HAI TIN");
});

// ------------------------------------------------------------------ PRICE UX

console.log("\n== price section ==");

check("48. chênh giá: hiển thị 2 cách ghi + chênh lệch tuyệt đối + %", () => {
  const r = run(CASE_A_A, CASE_A_B);
  assert.equal(r.price.status, "compared");
  const joined = r.price.lines.join(" | ");
  assert.ok(joined.includes("Tin A ghi 4,8 tỷ."));
  assert.ok(joined.includes("Tin B ghi 5,2 tỷ."));
  assert.ok(joined.includes("Chênh lệch giá niêm yết: 400 triệu."));
  assert.ok(joined.includes("8,0%"));
  // Không gọi chênh lệch là đáng ngờ.
  assert.ok(!joined.toLowerCase().includes("đáng ngờ"));
  assertNoForbidden(r.price.lines, "price-section");
});

check("49. giá bằng nhau -> câu bằng nhau ĐÚNG hợp đồng", () => {
  const r = run(CASE_A_A, CASE_A_A);
  assert.equal(r.price.status, "equal");
  assert.ok(r.price.lines.includes(PRICE_EQUAL_TEXT));
});

check("50. per_m2 vs total -> không so sánh làm hai giá bán (case G)", () => {
  const r = run(
    "Đất 80 triệu/m², vị trí đẹp, thổ cư 100%, cần bán gấp.",
    "Căn 68m2 2 phòng ngủ, giá 4,8 tỷ, nội thất mới.",
  );
  assert.equal(r.price.status, "unavailable");
});

check("51. '4 tỷ 800' vs '4,8 tỷ' -> tổng bằng nhau (case F)", () => {
  const r = run(
    "Nhà cần bán gấp, giá 4 tỷ 800, sổ hồng riêng, hẻm xe hơi.",
    "Nhà cần bán gấp, giá 4,8 tỷ, sổ hồng riêng, hẻm xe hơi.",
  );
  assert.equal(r.price.status, "equal");
});

// ------------------------------------------------------------------ PRIVACY

console.log("\n== privacy / determinism ==");

/** Bỏ comment để không quét nhầm phần mô tả ràng buộc. */
function codeOnly(file: string): string {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
}

check("52. lib KHÔNG có mạng/DB/storage/await", () => {
  for (const f of ["prices.ts", "compare.ts", "wording.ts"]) {
    const code = codeOnly(`${LIB_DIR}/${f}`);
    for (const bad of [
      "fetch(",
      "/api/",
      "supabase",
      "createClient",
      "adminClient",
      "await ",
      "localStorage",
      "sessionStorage",
      "XMLHttpRequest",
      "trackEvent",
      "lib/analytics",
    ]) {
      assert.equal(code.includes(bad), false, `${f} không được chứa "${bad}"`);
    }
  }
});

check("53. client KHÔNG fetch, KHÔNG storage, KHÔNG analytics", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  for (const bad of ["fetch(", "localStorage", "sessionStorage", "XMLHttpRequest", "trackEvent", "lib/analytics"]) {
    assert.equal(src.includes(bad), false, `client không được chứa "${bad}"`);
  }
});

check("54. chỉ import helper được phép, không import Phase 4/5/6/Deal Grader", () => {
  for (const f of [CLIENT_SRC, `${LIB_DIR}/compare.ts`, `${LIB_DIR}/prices.ts`, `${LIB_DIR}/wording.ts`, PAGE_SRC]) {
    const code = codeOnly(f);
    for (const bad of [
      "lib/call-queue",
      "lib/urgency-check",
      "lib/deal-grader",
      "components/urgency-check",
      "components/deal-grader",
      "components/owner-signals",
      "dashboard/bulk-check",
      "app/api",
      "lib/scoring",
      "lib/check-route",
      "lib/quota",
    ]) {
      assert.equal(code.includes(bad), false, `${f} không được import "${bad}"`);
    }
  }
  const src = codeOnly(`${LIB_DIR}/compare.ts`) + codeOnly(`${LIB_DIR}/prices.ts`);
  const sharedImports = [...src.matchAll(/from "@\/lib\/([a-z-]+)(?:\/([a-z-]+))?"/g)].map(
    (m) => `${m[1]}/${m[2] ?? ""}`,
  );
  for (const imp of new Set(sharedImports)) {
    assert.ok(
      ["owner-signals/normalize", "area/", "bedrooms/", "provinces/"].some((allowed) =>
        imp.startsWith(allowed.replace("/", "/")),
      ) || ["area", "bedrooms", "provinces"].includes(imp.split("/")[0]) || imp.startsWith("owner-signals/"),
      `import ngoài danh mục cho phép: ${imp}`,
    );
  }
  assert.equal(src.includes("owner-signals/normalize"), true, "dùng lại normalize của Phase 4");
});

check("55. không sửa helper dùng chung: chỉ import, không copy logic", () => {
  const src = codeOnly(`${LIB_DIR}/compare.ts`);
  // Dùng hàm thật, không copy regex area/bedroom.
  assert.equal(src.includes("extractAreaM2"), true, "phải gọi extractAreaM2 của lib/area");
  assert.equal(src.includes("extractBedrooms"), true, "phải gọi extractBedrooms của lib/bedrooms");
  assert.equal(src.includes("detectProvince"), true, "phải gọi detectProvince của lib/provinces");
  assert.equal(/AREA_M2_RE|AREA_RE\s*=/.test(src), false, "không được copy regex diện tích");
});

check("56. input KHÔNG bị đổi", () => {
  const a = CASE_A_A;
  const b = CASE_A_B;
  compareDuplicate({ textA: a, textB: b });
  assert.equal(a, CASE_A_A);
  assert.equal(b, CASE_A_B);
});

check("57. tất định: cùng input -> deepEqual", () => {
  for (const [a, b] of [
    [CASE_A_A, CASE_A_B],
    [TOWER_A, TOWER_B],
    [PROV_A, PROV_B],
  ]) {
    assert.deepEqual(compareDuplicate({ textA: a, textB: b }), compareDuplicate({ textA: a, textB: b }));
  }
});

check("58. tin quá ngắn -> null, không ép so sánh", () => {
  assert.equal(compareDuplicate({ textA: "nhà đẹp", textB: CASE_A_B }), null);
  assert.equal(compareDuplicate({ textA: CASE_A_A, textB: "x".repeat(MIN_TEXT_LENGTH - 1) }), null);
  assert.equal(compareDuplicate({ textA: "   ", textB: " " }), null);
  assert.ok(run(CASE_A_A, CASE_A_B));
});

check("59. trần độ dài khớp chuẩn sản phẩm (1000)", () => {
  assert.equal(MAX_TEXT_LENGTH, 1000);
});

// ------------------------------------------------------------- SEO / UI static

console.log("\n== SEO / UI static ==");

check("60. route tồn tại + H1 EXACT", () => {
  assert.ok(existsSync(PAGE_SRC), `${PAGE_SRC} phải tồn tại`);
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(src.includes("So sánh 2 tin BĐS có dấu hiệu giống nhau"), "H1 phải đúng");
});

check("61. title + canonical EXACT", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(src.includes("So sánh 2 tin BĐS có dấu hiệu giống nhau | CheckBDS"), "title phải đúng");
  assert.ok(src.includes('canonical: "/tools/so-sanh-hai-tin-bds"'), "canonical phải đúng");
});

check("62. description ĐÚNG hợp đồng, metadata sạch claim SEO cấm", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(
    src.includes(
      "Dán 2 tin BĐS để xem điểm giống và khác (dự án, vị trí, diện tích, phòng ngủ, giá niêm yết) kèm câu hỏi đối chiếu. Chỉ so sánh câu chữ bạn dán, không xác nhận cùng tài sản.",
    ),
    "description phải đúng hợp đồng",
  );
  const metaBlock = src.slice(0, src.indexOf("const FAQS"));
  for (const bad of ["giá ảo", "giá thật", "tin giả", "xác minh tin trùng", "phát hiện tin giả"]) {
    assert.equal(metaBlock.includes(bad), false, `metadata không được chứa "${bad}"`);
  }
});

check("63. FAQ 5 câu, đủ chủ đề bắt buộc", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  const re = /q:\s*"((?:[^"\\]|\\.)*)"/g;
  const qs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) qs.push(m[1]);
  assert.equal(qs.length, 5, `phải đúng 5 câu FAQ, gặp ${qs.length}`);
  assert.ok(qs.some((q) => q.includes("cùng một tài sản")), "thiếu FAQ xác nhận tài sản");
  assert.ok(qs.some((q) => q.includes("tin nào sai") || q.includes("giá khác nhau")), "thiếu FAQ giá khác nhau");
  assert.ok(qs.some((q) => q.includes("cùng căn")), "thiếu FAQ cùng căn");
  assert.ok(qs.some((q) => q.includes("được lưu")), "thiếu FAQ lưu nội dung");
  assert.ok(qs.some((q) => q.includes("số điện thoại")), "thiếu FAQ số điện thoại");
});

check("64. FAQ dùng CÙNG một mảng cho hiển thị và JSON-LD", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.equal([...src.matchAll(/const FAQS = \[/g)].length, 1, "chỉ khai báo FAQS một lần");
  assert.ok(src.includes("{FAQS.map"), "phải map FAQS để render");
  assert.ok(src.includes("mainEntity: FAQS.map"), "JSON-LD phải dùng cùng mảng");
  assert.ok(src.includes("FAQPage"));
});

check("65. FAQ sạch claim bị cấm", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  const re = /(?:q|a):\s*"((?:[^"\\]|\\.)*)"/g;
  const texts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) texts.push(m[1].replace(/\\"/g, '"'));
  assertNoForbidden(texts, "FAQ");
});

check("66. sitemap có route, monthly, 0.8", () => {
  const src = readFileSync("app/sitemap.ts", "utf8");
  const line = src.split(/\r?\n/).find((l) => l.includes("/tools/so-sanh-hai-tin-bds"));
  assert.ok(line, "sitemap phải có route");
  assert.ok(line.includes("monthly"));
  assert.ok(line.includes("0.8"));
});

check("67. CTA 'So sánh 2 tin' EXACT, >= 48px, hai textarea đúng nhãn", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes("So sánh 2 tin"), "CTA đúng nhãn");
  const heights = [...src.matchAll(/h-\[(\d+)px\]/g)].map((x) => Number(x[1]));
  assert.ok(heights.length >= 1);
  for (const h of heights) assert.ok(h >= 48, `nút ${h}px phải >= 48px`);
  assert.ok(src.includes("h-12"), "CTA phụ dùng 48px");
  assert.ok(src.includes('id="listing-a"') && src.includes('id="listing-b"'), "phải có 2 ô tin");
  assert.ok(src.includes("htmlFor={id}") && src.includes("aria-describedby={`${id}-hint`}"));
  assert.ok(src.includes('label="Tin A"') && src.includes('label="Tin B"'));
  assert.ok(src.includes("maxLength={MAX_TEXT_LENGTH}"));
  assert.ok(src.includes("aria-disabled"));
});

check("68. cross-tool CTA đúng route hiện có, không tự thêm route khác", () => {
  assert.equal(CROSS_TOOL.length, 3);
  assert.ok(CROSS_TOOL.some((t) => t.text === "Chấm điểm từng tin" && t.href === "/tools/cham-diem-tin-dang"));
  assert.ok(
    CROSS_TOOL.some((t) => t.text === "Kiểm tra dấu hiệu bán gấp" && t.href === "/tools/kiem-tra-dau-hieu-ban-gap"),
  );
  assert.ok(
    CROSS_TOOL.some((t) => t.text === "Kiểm tra pháp lý trước cọc" && t.href === "/tools/kiem-tra-phap-ly-truoc-coc"),
  );
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.equal(src.includes("tin-chinh-chu"), false, "không tích hợp Owner/Broker");
});

check("69. package.json nối test mới vào CUỐI chuỗi, không đổi gì khác", () => {
  const pkg = readFileSync("package.json", "utf8");
  assert.ok(pkg.includes("tests/duplicate-check.test.ts"), "phải có test mới trong chuỗi npm test");
  assert.ok(
    pkg.includes("tests/urgency-check.test.ts  &&  node --experimental-strip-types --import ./tests/register-loader.mjs tests/duplicate-check.test.ts"),
    "test mới nối sau urgency-check",
  );
  assert.equal(pkg.includes("duplicate-check.test.ts\" &&"), false, "không thêm gì sau test mới");
});

// ------------------------------- OMP remediation (B-1 / B-2 / §18-§20 / S-1)

console.log("\n== OMP B-1: dự án giả từ cụm mô tả chung ==");

check("70. B-1 'Căn Hộ Cao Cấp...' x2 -> KHÔNG có bằng chứng dự án, không HIGH", () => {
  const r = run(
    "Căn Hộ Cao Cấp 68m2 2 phòng ngủ, nội thất đẹp.",
    "Căn Hộ Cao Cấp 68m2 2 phòng ngủ, nội thất đẹp.",
  );
  assert.equal(r.shared.some((s) => s.kind === "project"), false, "không được có M1 giả");
  assert.notEqual(r.level, "high", "mức KHÔNG được lên HIGH nhờ M1 giả");
});

check("71. B-1 'Cao Cấp' vs 'Đẹp Giá Rẻ' -> KHÔNG có mâu thuẫn dự án giả", () => {
  const r = run(
    "Căn hộ Cao Cấp 68m2 2 phòng ngủ, nội thất đẹp.",
    "Căn hộ Đẹp Giá Rẻ 68m2 2 phòng ngủ, nội thất đẹp.",
  );
  assert.equal(r.hasMajor, false, "generic mismatch không được thành MAJOR");
  assert.equal(r.contradictions.some((c) => c.text.includes("dự án")), false);
});

check("72. B-1 'Dự án Cao Cấp...' x2 -> marker hẹp cũng phải loại tên generic", () => {
  const r = run(
    "Dự án Cao Cấp 68m2 2 phòng ngủ, nội thất đẹp.",
    "Dự án Cao Cấp 68m2 2 phòng ngủ, nội thất đẹp.",
  );
  assert.equal(r.shared.some((s) => s.kind === "project"), false);
});

check("73. B-1 'Chung cư Nội Thất Mới...' -> không có bằng chứng dự án", () => {
  const r = run(
    "Chung cư Nội Thất Mới 68m2 2 phòng ngủ, giá 3 tỷ.",
    "Chung cư Nội Thất Mới 68m2 2 phòng ngủ, giá 3 tỷ.",
  );
  assert.equal(r.shared.some((s) => s.kind === "project"), false);
});

check("74. B-1 dương 'Căn hộ Masteri Thảo Điền' -> M1 thật", () => {
  const r = run(
    "Căn hộ Masteri Thảo Điền 68m2 2 phòng ngủ, giá 4 tỷ.",
    "Căn hộ Masteri Thảo Điền 68m2 2 phòng ngủ, giá 4 tỷ.",
  );
  const p = r.shared.find((s) => s.kind === "project");
  assert.ok(p, "Masteri Thảo Điền phải được nhận");
  assert.ok(p.text.includes("Masteri Thảo Điền"));
});

check("75. B-1 dương 'Dự án Ecopark' -> 1 token distinctive được nhận", () => {
  const r = run(
    "Dự án Ecopark 70m2 2 phòng ngủ, giá 3 tỷ.",
    "Dự án Ecopark 70m2 2 phòng ngủ, giá 3 tỷ.",
  );
  assert.ok(r.shared.some((s) => s.kind === "project" && s.text.includes("Ecopark")));
});

check("76. B-1 dương 'Khu đô thị Sala' -> M1", () => {
  const r = run(
    "Khu đô thị Sala 90m2 2 phòng ngủ, giá 5 tỷ.",
    "Khu đô thị Sala 90m2 2 phòng ngủ, giá 5 tỷ.",
  );
  assert.ok(r.shared.some((s) => s.kind === "project" && s.text.includes("Sala")));
});

check("77. B-1 'Đối diện chung cư Sunrise City' -> chỗ lân cận, không phải dự án của tin", () => {
  const t = "Nhà hẻm đối diện chung cư Sunrise City, 68m2, 2 phòng ngủ, giá 3 tỷ.";
  const r = run(t, t);
  assert.equal(r.shared.some((s) => s.kind === "project"), false);
});

check("78. B-1 mâu thuẫn dự án thật (cả hai qua kiểm tra chặt) vẫn là MAJOR", () => {
  const r = run(
    "Dự án Vinhomes Grand Park 68m2, 2 phòng ngủ, giá 4 tỷ.",
    "Dự án Masteri Thảo Điền 68m2, 2 phòng ngủ, giá 4 tỷ.",
  );
  assert.equal(r.hasMajor, true);
  assert.ok(
    r.contradictions.some((c) => c.text.includes("Vinhomes") && c.text.includes("Masteri")),
  );
});

console.log("\n== OMP B-2: M6 không đếm lại trường đã tính ==");

check("79. B-2 case A x2 -> KHÔNG M6 chứa Vinhomes/Grand/Park", () => {
  const r = run(CASE_A_A, CASE_A_A);
  const spans = r.shared.filter((s) => s.kind === "text_span");
  assert.ok(spans.length >= 1, "vẫn phải có cụm mô tả thật sự riêng");
  for (const s of spans) {
    assert.equal(/vinhomes|grand|park/i.test(s.text), false, `M6 đếm lại token dự án: ${s.text}`);
  }
});

check("80. B-2 cụm vị trí -> KHÔNG M6 chứa Nguyễn/Văn/Linh, span riêng vẫn được", () => {
  const t = "Nhà 68m2 đường Nguyễn Văn Linh, ban công hướng đông, nội thất mới.";
  const r = run(t, t);
  assert.ok(r.shared.some((s) => s.kind === "location_phrase"), "phải có M4");
  const spans = r.shared.filter((s) => s.kind === "text_span");
  for (const s of spans) {
    assert.equal(/nguyễn|văn|linh/i.test(s.text), false, `M6 đếm lại token vị trí: ${s.text}`);
  }
  assert.ok(spans.some((s) => s.text.includes("ban công hướng đông")), "span mô tả riêng vẫn được tính");
});

check("81. B-2 dự án lặp 3 lần -> 1 M1, 0 M6 nguồn dự án", () => {
  const a = "Dự án Vinhomes Grand Park. Vinhomes Grand Park 68m2. Dự án Vinhomes Grand Park 2pn.";
  const b = "Dự án Vinhomes Grand Park 70m2, 2 phòng ngủ, cần bán gấp.";
  const r = run(a, b);
  assert.equal(r.shared.filter((s) => s.kind === "project").length, 1);
  const spans = r.shared.filter((s) => s.kind === "text_span");
  for (const s of spans) {
    assert.equal(/vinhomes|grand|park/i.test(s.text), false, `M6 nguồn dự án: ${s.text}`);
  }
});

console.log("\n== OMP §18/§19/§20: ranh giới cứng và generic superset ==");

check("82. §18 phone bridge -> không cụm xuyên qua SĐT, SĐT đóng góp 0", () => {
  const a = "view sông tầng trung 0905123456 ban công hướng đông nội thất đẹp";
  const b = "view sông tầng trung 0988777666 ban công hướng đông nội thất đẹp";
  const r = run(a, b);
  const { all } = resultStrings(r);
  assert.equal(all.some((s) => s.includes("0905123456") || s.includes("0988777666")), false);
  const spans = r.shared.filter((s) => s.kind === "text_span");
  assert.equal(spans.length, 1, "chỉ cụm sau điện thoại là bằng chứng");
  assert.equal(spans[0].text.includes("tầng trung"), false, "không được nối xuyên qua SĐT");
  // Quote phải là đoạn LIÊN TỤC thật trong văn bản gốc (không phải cụm nhân tạo).
  const squeezed = b.replace(/\s+/g, " ");
  for (const s of spans) {
    const quote = s.text.replace(/^.*: “/, "").replace(/”$/, "");
    assert.ok(squeezed.includes(quote), `quote không liên tục trong bản gốc: ${quote}`);
  }
});

check("83. §18 URL bridge -> không cụm xuyên qua URL", () => {
  const a = "view sông tầng trung https://a.vn/x ban công hướng đông";
  const b = "view sông tầng trung https://b.vn/y ban công hướng đông";
  const r = run(a, b);
  const { all } = resultStrings(r);
  assert.equal(
    all.some((s) => s.includes("https") || s.includes("a.vn") || s.includes("b.vn")),
    false,
  );
  assert.equal(r.shared.filter((s) => s.kind === "text_span").length, 0);
});

check("84. §19 ranh giới câu -> không cụm xuyên qua dấu chấm", () => {
  const a = "view sông tầng trung. Ban công hướng đông nội thất đẹp.";
  const b = "view sông tầng trung ban công hướng đông nội thất đẹp.";
  const r = run(a, b);
  const spans = r.shared.filter((s) => s.kind === "text_span");
  for (const s of spans) {
    assert.equal(
      s.text.includes("tầng trung") && s.text.includes("hướng đông"),
      false,
      `cụm xuyên ranh giới câu: ${s.text}`,
    );
  }
  assert.ok(spans.some((s) => s.text.includes("ban công hướng đông")), "cụm sau dấu chấm vẫn được tính riêng");
});

check("85. §20 generic superset -> token đệm không làm cụm quảng cáo 'đặc trưng'", () => {
  for (const [x, y] of [
    ["Nhà đẹp vị trí đẹp sổ hồng riêng liên hệ ngay cần bán gấp.", "Nhà đẹp vị trí đẹp sổ hồng riêng liên hệ ngay cần bán gấp."],
    ["Nhà mới gần trường học vị trí đẹp sổ hồng riêng liên hệ ngay.", "Nhà mới gần trường học vị trí đẹp sổ hồng riêng liên hệ ngay."],
  ]) {
    const r = run(x, y);
    assert.equal(r.shared.some((s) => s.kind === "text_span"), false, `cụm quảng cáo phải bị loại: ${x.slice(0, 20)}`);
  }
});

console.log("\n== OMP S-1: biên trái số giá ==");

check("86. S-1 giá lỗi dấu phân cách -> none, không cứu vớt bằng khớp đuôi", () => {
  for (const bad of [
    "Nhà giá 12.34.567 triệu, cần bán.",
    "Nhà giá 12,34,567 triệu, cần bán.",
    "Giá 4,,8 tỷ chốt.",
    "Giá 4..8 tỷ chốt.",
    "Giá 1,2.3 tỷ chốt.",
    "Giá 1.2,3 tỷ chốt.",
    "abc34.567 triệu cần bán.",
  ]) {
    assert.equal(parseListingPrice(bad).kind, "none", `phải là none: ${bad}`);
  }
});

check("87. S-1 giá hợp lệ vẫn nhận đúng sau khi thêm biên trái", () => {
  const t1 = parseListingPrice("Bán 1.200 triệu gấp.");
  assert.equal(t1.kind === "total" ? t1.valueVnd : 0, 1_200_000_000);
  const t2 = parseListingPrice("Nhà 1,2 tỷ cần bán.");
  assert.equal(t2.kind === "total" ? t2.valueVnd : 0, 1_200_000_000);
  const t3 = parseListingPrice("Nhà 4.8 tỷ cần bán.");
  assert.equal(t3.kind === "total" ? t3.valueVnd : 0, 4_800_000_000);
  const t4 = parseListingPrice("Nhà 4800 triệu cần bán.");
  assert.equal(t4.kind === "total" ? t4.valueVnd : 0, 4_800_000_000);
  const t5 = parseListingPrice("Nhà cần bán gấp, giá 4 tỷ 800.");
  assert.equal(t5.kind === "total" ? t5.valueVnd : 0, 4_800_000_000);
});

check("88. S-1 precedence hiện hành được GIỮ NGUYÊN (accepted)", () => {
  const r1 = parseListingPrice("Giá 4-5 tỷ, hiện chốt 4,8 tỷ.");
  assert.equal(r1.kind, "total");
  assert.equal(r1.kind === "total" ? r1.valueVnd : 0, 4_800_000_000);
  const r2 = parseListingPrice("80 triệu/m², tổng 4,8 tỷ.");
  assert.equal(r2.kind, "total");
  assert.equal(r2.kind === "total" ? r2.valueVnd : 0, 4_800_000_000);
});

check("89. S-1 trong compareDuplicate: giá lỗi không sinh tổng giả", () => {
  const t = "Nhà đẹp 68m2 2 phòng ngủ, giá 12.34.567 triệu, sổ riêng.";
  const r = run(t, t);
  assert.equal(r.price.status, "unavailable", "không được so sánh từ giá lỗi");
  assert.deepEqual(r.price.lines, [PRICE_UNAVAILABLE_NOTE]);
});

// --------------------- OMP narrow remediation: B-1 residual (marker rộng)

console.log("\n== OMP B-1 residual: cụm mô tả Title Case sau marker rộng ==");

check("90. B-1 residual: 12 cụm mô tả phổ biến -> KHÔNG M1 giả", () => {
  const bads = [
    "Căn Hộ View Đẹp 68m2 2 phòng ngủ, nội thất mới.",
    "Căn Hộ Full Nội Thất 68m2 2 phòng ngủ, ban công lớn.",
    "Căn Hộ Mới Bàn Giao 68m2 2 phòng ngủ, gần chợ.",
    "Căn Hộ Giá Tốt 68m2 2 phòng ngủ, chủ nhà cần bán.",
    "Căn Hộ Góc Hai Mặt Tiền 68m2 2 phòng ngủ, view thoáng.",
    "Căn Hộ Siêu Phẩm Đầu Tư 68m2 2 phòng ngủ, dòng tiền tốt.",
    "Căn Hộ Hướng Đông Nam 68m2 2 phòng ngủ, gió mát.",
    "Căn Hộ View Sông 68m2 2 phòng ngủ, tầng trung.",
    "Căn Hộ Nội Thất Cao Cấp 68m2 2 phòng ngủ, sang trọng.",
    "Căn Hộ Tầng Trung View Sông 68m2 2 phòng ngủ, mát mẻ.",
    "Chung Cư View Biển 68m2 2 phòng ngủ, nghỉ dưỡng.",
    "Chung Cư Mới Bàn Giao 68m2 2 phòng ngủ, giá tốt.",
  ];
  for (const t of bads) {
    const r = run(t, t);
    assert.equal(
      r.shared.some((s) => s.kind === "project"),
      false,
      `không được có M1 giả: ${t.slice(0, 26)}`,
    );
  }
});

check("91. B-1 residual: mismatch mô tả -> KHÔNG mâu thuẫn dự án, không MAJOR giả", () => {
  for (const [x, y] of [
    ["Căn Hộ View Đẹp 68m2 2 phòng ngủ, nội thất mới.", "Căn Hộ Full Nội Thất 68m2 2 phòng ngủ, ban công lớn."],
    ["Căn Hộ Hướng Đông Nam 68m2 2 phòng ngủ, gió mát.", "Căn Hộ Góc Hai Mặt Tiền 68m2 2 phòng ngủ, view thoáng."],
  ]) {
    const r = run(x, y);
    assert.equal(r.hasMajor, false, "mismatch generic không được thành MAJOR");
    assert.equal(r.contradictions.some((c) => c.text.includes("dự án")), false);
    assert.notEqual(r.level, "low", "không được LOW giả vì dự án");
  }
});

check("92. B-1 residual dương: tên thật sau marker rộng vẫn ra M1", () => {
  for (const t of [
    "Căn hộ Vinhomes Grand Park 68m2 2 phòng ngủ, giá 4 tỷ.",
    "Căn hộ Masteri Thảo Điền 68m2 2 phòng ngủ, giá 4 tỷ.",
    "Chung cư Sunrise City 68m2 2 phòng ngủ, giá 3 tỷ.",
    "Căn hộ Celesta Rise 68m2 2 phòng ngủ, giá 3 tỷ.",
    "Căn hộ The Beverly 68m2 2 phòng ngủ, giá 5 tỷ.",
  ]) {
    const r = run(t, t);
    assert.ok(r.shared.some((s) => s.kind === "project"), `phải có M1: ${t.slice(0, 24)}`);
  }
});

check("93. B-1 residual dương: marker hẹp giữ nguyên hành vi (Ecopark, Sala)", () => {
  const r1 = run("Dự án Ecopark 70m2 2 phòng ngủ, giá 3 tỷ.", "Dự án Ecopark 70m2 2 phòng ngủ, giá 3 tỷ.");
  assert.ok(r1.shared.some((s) => s.kind === "project" && s.text.includes("Ecopark")));
  const r2 = run("Khu đô thị Sala 90m2 2 phòng ngủ, giá 5 tỷ.", "Khu đô thị Sala 90m2 2 phòng ngủ, giá 5 tỷ.");
  assert.ok(r2.shared.some((s) => s.kind === "project" && s.text.includes("Sala")));
});

check("94. B-1 residual: marker hẹp với tên toàn generic vẫn bị loại", () => {
  for (const t of [
    "Dự án Cao Cấp 68m2 2 phòng ngủ, nội thất đẹp.",
    "Dự án Giá Tốt 68m2 2 phòng ngủ, cần bán.",
    "Khu đô thị Mới Bàn Giao 68m2 2 phòng ngủ, gần trường.",
  ]) {
    const r = run(t, t);
    assert.equal(r.shared.some((s) => s.kind === "project"), false, `không được có M1: ${t.slice(0, 20)}`);
  }
});

check("95. B-1 residual: proximity 'cạnh' không đổi hành vi", () => {
  const t = "Nhà hẻm cạnh chung cư Masteri Thảo Điền, 68m2, 2 phòng ngủ, giá 3 tỷ.";
  const r = run(t, t);
  assert.equal(r.shared.some((s) => s.kind === "project"), false, "chỗ lân cận không phải dự án của tin");
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
