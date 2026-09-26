// Self-check: thống kê admin. Chạy: npm test
import { strict as assert } from "node:assert";
import { countByDay, goodDealRate, hostOf, topCounts } from "../lib/admin-stats.ts";

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
  console.log("\n== countByDay ==");

  await check("đủ N ngày, thiếu ngày -> count 0", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    const rows = [
      { created_at: "2026-09-26T03:00:00Z" }, // 10h VN ngày 26
      { created_at: "2026-09-26T04:00:00Z" }, // 11h VN ngày 26
      { created_at: "2026-09-24T12:00:00Z" }, // 19h VN ngày 24
      { created_at: "2026-09-18T03:00:00Z" }, // ngoài 7 ngày
    ];
    const d = countByDay(rows, 7, now);
    assert.equal(d.length, 7);
    const byDate = Object.fromEntries(d.map((x) => [x.date, x.count]));
    assert.equal(byDate["2026-09-26"], 2);
    assert.equal(byDate["2026-09-25"], 0);
    assert.equal(byDate["2026-09-24"], 1);
    assert.equal(byDate["2026-09-20"], 0);
  });

  await check("cắt ngày theo giờ VN (UTC+7)", () => {
    // 17h UTC ngày 25 = 0h VN ngày 26 -> phải tính vào 26
    const now = new Date("2026-09-26T05:00:00Z");
    const d = countByDay([{ created_at: "2026-09-25T17:00:00Z" }], 7, now);
    assert.equal(d[d.length - 1].date, "2026-09-26");
    assert.equal(d[d.length - 1].count, 1);
  });

  console.log("\n== topCounts ==");

  await check("đếm top N, bỏ giá trị rỗng, sắp theo số lượng", () => {
    const t = topCounts(["Hà Nội", "TP.HCM", "TP.HCM", null, "", "Huế", "TP.HCM"], 2);
    assert.equal(t.length, 2);
    assert.deepEqual(t[0], { label: "TP.HCM", count: 3 });
    assert.equal(t[1].count, 1);
  });

  await check("hostOf bỏ www, URL hỏng trả null", () => {
    assert.equal(hostOf("https://www.nhatot.com/mua-ban/1.htm"), "nhatot.com");
    assert.equal(hostOf("http://checkbds.online/dashboard"), "checkbds.online");
    assert.equal(hostOf("không phải url"), null);
    assert.equal(hostOf(null), null);
    assert.equal(hostOf(""), null);
  });

  console.log("\n== goodDealRate ==");

  await check("tỉ lệ kèo ngon >80 điểm", () => {
    assert.equal(goodDealRate([{ score: 90 }, { score: 80 }, { score: 50 }, { score: 20 }]), 50);
    assert.equal(goodDealRate([]), 0);
    assert.equal(goodDealRate([{ score: 85 }]), 100);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
