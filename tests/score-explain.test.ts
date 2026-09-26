// Self-check: giải thích điểm số +/-. Chạy: npm test
import { strict as assert } from "node:assert";
import { scoreContributions } from "../lib/score-explain.ts";
import { analyzeListing } from "../lib/scoring.ts";
import type { AnalysisResult } from "../lib/types.ts";

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
  console.log("\n== scoreContributions ==");

  const good = analyzeListing(
    "Bán gấp! Nhà mặt tiền Thùy Vân Vũng Tàu 80m2, ngân hàng thanh lý, " +
      "giá 5.5 tỷ rẻ hơn thị trường 1 tỷ, sổ hồng riêng, hẻm xe hơi.",
  );
  const bad = analyzeListing(
    "Bán nhà hẻm nhỏ 1m ở xa trung tâm, giấy tay, đang tranh chấp, " +
      "giá cao hơn thị trường, ngập nước mùa mưa.",
  );

  await check("tách được thành nhiều yếu tố có +/-", () => {
    const c = scoreContributions(good);
    assert.ok(c.length >= 5, `quá ít yếu tố: ${c.length}`);
    assert.ok(c.some((x) => x.delta > 0), "phải có yếu tố cộng điểm");
  });

  await check("sắp theo mức ảnh hưởng giảm dần", () => {
    const c = scoreContributions(good);
    for (let i = 1; i < c.length; i++) {
      assert.ok(
        Math.abs(c[i - 1].delta) >= Math.abs(c[i].delta),
        `sai thứ tự tại ${i}: ${c[i - 1].delta} rồi ${c[i].delta}`,
      );
    }
  });

  await check("yếu tố giá đổi nhãn theo chiều chênh lệch", () => {
    const g = scoreContributions(good).find((x) => x.label.includes("Giá"));
    const b = scoreContributions(bad).find((x) => x.label.includes("Giá"));
    assert.ok(g && g.delta > 0, "giá rẻ hơn phải là điểm cộng");
    assert.ok(b && b.delta < 0, "giá cao hơn phải là điểm trừ");
  });

  await check("tin rủi ro phải có dòng trừ điểm rủi ro", () => {
    const c = scoreContributions(bad);
    assert.ok(c.some((x) => x.label === "Yếu tố rủi ro" && x.delta < 0));
  });

  await check("tin tốt không bịa dòng rủi ro", () => {
    const c = scoreContributions(good);
    assert.ok(!c.some((x) => x.label === "Yếu tố rủi ro"));
  });

  await check("luôn có ghi chú giải thích cho từng yếu tố", () => {
    for (const r of [good, bad] as AnalysisResult[]) {
      for (const c of scoreContributions(r)) {
        assert.ok(c.note && c.note.length > 0, `thiếu note: ${c.label}`);
        assert.ok(["plus", "minus", "neutral"].includes(c.kind));
      }
    }
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
