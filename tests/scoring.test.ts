// Self-check: nhận diện tỉnh + chấm điểm local. Chạy: npm test
// Dùng assert thuần, không thêm test framework.

import { strict as assert } from "node:assert";
import { detectProvince, provinceLabel } from "../lib/provinces.ts";
import { analyzeListing, fromApiResponse } from "../lib/scoring.ts";
import type { AnalysisResult, CheckApiResponse } from "../lib/types.ts";

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
  console.log("\n== detectProvince ==");

  await check("nhận ra Vũng Tàu không dấu", () => {
    assert.equal(detectProvince("Bán gấp nhà mặt tiền Thuy Van, Vung Tau 80m2 giá 5.5 tỷ"), "Vũng Tàu");
  });

  await check("nhận ra Vũng Tàu có dấu", () => {
    assert.equal(detectProvince("Nhà hẻm Thùy Vân, Vũng Tàu, sổ hồng riêng"), "Vũng Tàu");
  });

  await check("nhận ra Hà Nội qua quận", () => {
    assert.equal(detectProvince("Chung cư Cầu Giấy, sổ đỏ, giá 3.2 tỷ"), "Hà Nội");
  });

  await check("nhận ra TP.HCM qua Sài Gòn", () => {
    assert.equal(detectProvince("Nhà hẻm xe hơi Sài Gòn, quận Bình Thạnh"), "TP.HCM");
  });

  await check("ưu tiên từ khóa dài hơn (Thùy Vân > Vũng Tàu)", () => {
    assert.equal(detectProvince("Mặt tiền Thùy Vân Vũng Tàu"), "Vũng Tàu");
  });

  await check("không khớp -> null", () => {
    assert.equal(detectProvince("Bán đất nền giá rẻ, sổ hồng riêng, liên hệ 0909"), null);
  });

  await check("provinceLabel fallback", () => {
    assert.equal(provinceLabel(null), "Khu vực của bạn");
    assert.equal(provinceLabel("Huế"), "Huế");
  });

  console.log("\n== analyzeListing (local fallback) ==");

  const NGOP_TIN =
    "Bán gấp! Nhà mặt tiền Thùy Vân Vũng Tàu 80m2, ngân hàng thanh lý, " +
    "giá 5.5 tỷ rẻ hơn thị trường 1 tỷ, sổ hồng riêng, hẻm xe hơi.";

  await check("tin ngộp -> điểm cao, tag KÈO NGỘP NGON", () => {
    const r = analyzeListing(NGOP_TIN);
    assert.ok(r.overall >= 80, `overall=${r.overall}`);
    assert.equal(r.tag, "KÈO NGỘP NGON");
    assert.equal(r.tagColor, "green");
    assert.equal(r.actionType, "hot");
  });

  await check("tin ngộp -> breakdown đầy đủ 6 nhóm", () => {
    const r = analyzeListing(NGOP_TIN);
    assert.ok(r.breakdown.ngop.score > 70);
    assert.ok(r.breakdown.phapLy.score >= 90, `phapLy=${r.breakdown.phapLy.score}`);
    assert.ok(r.extracted.price.includes("5.5"));
    assert.ok(r.extracted.area.includes("80"));
  });

  await check("tin xấu -> điểm thấp, tag đỏ, action bỏ qua", () => {
    const r = analyzeListing(
      "Bán nhà hẻm nhỏ 1m ở xa trung tâm, giấy tay, đang tranh chấp, " +
        "giá cao hơn thị trường, ngập nước mùa mưa.",
    );
    assert.ok(r.overall < 50, `overall=${r.overall}`);
    assert.equal(r.tagColor, "red");
    assert.equal(r.actionType, "skip");
  });

  await check("điểm luôn trong khoảng 12-98", () => {
    for (const t of [NGOP_TIN, "tin ngắn", "Bán đất " + "x".repeat(500)]) {
      const r = analyzeListing(t);
      assert.ok(r.overall >= 12 && r.overall <= 98, `overall=${r.overall}`);
    }
  });

  console.log("\n== fromApiResponse ==");

  const local = analyzeListing(NGOP_TIN);

  await check("AI ngop_ngon 92đ -> KÈO NGỘP NGON", () => {
    const api = {
      investment_score: 92,
      deal_type: "ngop_ngon",
      is_ngop: 90,
      legal_safety: 95,
      location_growth: 3,
      liquidity: 4,
      province: "Vũng Tàu",
    } as unknown as CheckApiResponse;
    const r = fromApiResponse(api, local);
    assert.equal(r.overall, 92);
    assert.equal(r.tag, "KÈO NGỘP NGON");
    // Điểm AI thang 0-4 quy về 100: 3 -> 75
    assert.equal(r.breakdown.tangGia.score, 75);
    assert.equal(r.extracted.street, "Vũng Tàu");
  });

  await check("AI báo rủi ro pháp lý -> tag đỏ dù điểm trung bình", () => {
    const api = {
      investment_score: 55,
      deal_type: "rui_ro_phap_ly",
      is_ngop: 20,
      legal_safety: 25,
      location_growth: 2,
      liquidity: 2,
    } as unknown as CheckApiResponse;
    const r: AnalysisResult = fromApiResponse(api, local);
    assert.equal(r.tagColor, "red");
    assert.equal(r.actionType, "skip");
  });

  await check("AI thiếu điểm -> giữ điểm local", () => {
    const api = {} as CheckApiResponse;
    const r = fromApiResponse(api, local);
    assert.equal(r.overall, local.overall);
    assert.equal(r.tag, local.tag);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
