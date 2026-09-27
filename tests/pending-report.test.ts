// Self-check: pending-report (lưu/khôi report trước login). Chạy: npm test
// sessionStorage không có trong node -> mock tối thiểu trước khi import module.
import { strict as assert } from "node:assert";

const store = new Map<string, string>();
const fakeSessionStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
// @ts-expect-error mock cho node
globalThis.window = { sessionStorage: fakeSessionStorage };

const { savePendingReport, takePendingReport, clearPendingReport } = await import(
  "../lib/pending-report.ts"
);

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void | Promise<void>) {
  store.clear();
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
  console.log("\n== pending-report ==");

  await check("lưu rồi lấy đúng dữ liệu", () => {
    savePendingReport({ text: "Bán gấp nhà Thùy Vân 80m2", listingUrl: "https://x/1", returnTo: "/#kiem-tra" });
    const r = takePendingReport();
    assert.ok(r);
    assert.equal(r!.text, "Bán gấp nhà Thùy Vân 80m2");
    assert.equal(r!.listingUrl, "https://x/1");
    assert.equal(r!.returnTo, "/#kiem-tra");
  });

  await check("lấy là tiêu thụ 1 lần (lần 2 trả null)", () => {
    savePendingReport({ text: "abc", listingUrl: null, returnTo: "/" });
    assert.ok(takePendingReport());
    assert.equal(takePendingReport(), null);
  });

  await check("text rỗng thì không lưu", () => {
    savePendingReport({ text: "   ", listingUrl: null, returnTo: "/" });
    assert.equal(takePendingReport(), null);
  });

  await check("returnTo lạ (không bắt đầu /) thì về mặc định", () => {
    savePendingReport({ text: "abc", listingUrl: null, returnTo: "https://evil.com/x" });
    const r = takePendingReport();
    assert.ok(r);
    assert.equal(r!.returnTo, "/#kiem-tra");
  });

  await check("text quá dài thì cắt 1000 ký tự", () => {
    savePendingReport({ text: "x".repeat(2500), listingUrl: null, returnTo: "/" });
    const r = takePendingReport();
    assert.ok(r);
    assert.equal(r!.text.length, 1000);
  });

  await check("clear xoá hẳn", () => {
    savePendingReport({ text: "abc", listingUrl: null, returnTo: "/" });
    clearPendingReport();
    assert.equal(takePendingReport(), null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
