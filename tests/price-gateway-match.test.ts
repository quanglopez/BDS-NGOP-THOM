// Self-check: matcher tên địa danh của resolveAreaCode/resolveRegionCode.
// Chạy: npm test — stub fetchListings, không gọi network.
import { strict as assert } from "node:assert";
import { ChototGatewayAdapter, placeNameMatches } from "../lib/price/gateway.ts";

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

interface FakeAd {
  area_name?: string;
  area_v2?: number;
  region_name?: string;
  region_v2?: number;
}

/**
 * Adapter với fetchListings stub.
 * `ads` là kết quả gateway trả về cho MỌI truy vấn — mô phỏng tình huống
 * gateway chỉ có sẵn các tin đúng như vậy.
 */
function adapterWith(ads: FakeAd[]) {
  const a = new ChototGatewayAdapter();
  const calls: { query?: string | null; regionV2?: number | null }[] = [];
  a.fetchListings = async (s) => {
    calls.push({ query: s.query, regionV2: s.regionV2 });
    return ads;
  };
  return { a, calls };
}

const REGION_AD = { region_name: "Tp Hồ Chí Minh", region_v2: 79 };

async function main() {
  console.log("\n== PHASE 0.1. Phường đánh số KHÔNG được khớp chéo ==");

  await check("1. 'Phường 11' KHÔNG match 'Phường 1' -> trả null", async () => {
    // Gateway chỉ có Phường 1. Hỏi Phường 11 -> phải trượt.
    const { a } = adapterWith([{ area_name: "Phường 1", area_v2: 13011, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 11");
    assert.notEqual(r, 13011, "TUYỆT ĐỐI không được trả mã của Phường 1");
    assert.equal(r, null);
  });

  await check("2. 'Phường 1' KHÔNG match 'Phường 11' -> trả null", async () => {
    const { a } = adapterWith([{ area_name: "Phường 11", area_v2: 13011, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 1");
    assert.notEqual(r, 13011, "chiều ngược cũng phải trượt");
    assert.equal(r, null);
  });

  await check("1b. 'Xã 2' không khớp 'Xã 12' (cùng lớp lỗi)", async () => {
    const { a } = adapterWith([{ area_name: "Xã 12", area_v2: 31012, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Xã 2");
    assert.equal(r, null);
  });

  console.log("\n== PHASE 0.2. Exact match vẫn trả đúng mã ==");

  await check("3a. 'Phường 11' khớp 'Phường 11' -> đúng area_v2", async () => {
    const { a } = adapterWith([{ area_name: "Phường 11", area_v2: 13011, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 11");
    assert.equal(r, 13011);
  });

  await check("3b. Khác cách viết 'P.11'/'Phường 11' cùng khớp sau chuẩn hoá prefix", async () => {
    // stripAdminWords bỏ 'Phường ' nhưng KHÔNG bỏ 'P.' -> đây là giới hạn
    // đã biết: tên viết tắt sẽ trượt -> rơi về tỉnh. Ghi lại để không ai tưởng nó hoạt động.
    const { a } = adapterWith([{ area_name: "Phường 11", area_v2: 13011, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "P.11");
    assert.equal(r, null, "P.11 chưa được chuẩn hoá -> phải trượt an toàn");
  });

  await check("3c. region match chuẩn hoá 'Tp Hồ Chí Minh' vs 'Hồ Chí Minh'", async () => {
    const { a } = adapterWith([{ area_name: "Phường 11", area_v2: 13011, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Hồ Chí Minh", "Phường 11");
    assert.equal(r, 13011, "'tp ' bị bỏ ở cả hai nên vẫn khớp");
  });

  console.log("\n== PHASE 0.3. Tên không có số vẫn hoạt động ==");

  await check("4a. 'Gò Vấp' khớp 'Gò Vấp' -> 13001", async () => {
    const { a } = adapterWith([{ area_name: "Gò Vấp", area_v2: 13001, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Gò Vấp");
    assert.equal(r, 13001);
  });

  await check("4b. 'Phường Tân Bình' (nhiều từ) vẫn khớp", async () => {
    const { a } = adapterWith([{ area_name: "Phường Tân Bình", area_v2: 13007, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường Tân Bình");
    assert.equal(r, 13007);
  });

  await check("4c. Tên khác hẳn -> null, không đoán", async () => {
    const { a } = adapterWith([{ area_name: "Gò Vấp", area_v2: 13001, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Bình Thạnh");
    assert.equal(r, null);
  });

  console.log("\n== PHASE 0.4. placeNameMatches (hàm thuần) ==");

  await check("5. placeNameMatches chỉ chấp nhận ===, không bao giờ khớp includes", () => {
    assert.equal(placeNameMatches("11", "11"), true);
    assert.equal(placeNameMatches("1", "11"), false, "1 khác 11");
    assert.equal(placeNameMatches("11", "1"), false, "11 khác 1");
    assert.equal(placeNameMatches("", ""), true, "chuỗi rỗng bằng nhau về kỹ thuật");
    assert.equal(placeNameMatches("go vap", "go vap xa"), false, "không được khớp tiền tố");
    assert.equal(placeNameMatches("go vap xa", "go vap"), false, "không được khớp hậu tố");
  });

  console.log("\n== PHASE 0.5. Số lần gọi gateway ==");

  await check("6. resolveRegionCode trả ngay cg đầu -> 1 lần gọi", async () => {
    const { a, calls } = adapterWith([REGION_AD]);
    const r = await a.resolveRegionCode("Tp Hồ Chí Minh");
    assert.equal(r, 79);
    assert.equal(calls.length, 1, `gọi ${calls.length} lần, mong đợi 1`);
  });

  await check("7. resolveAreaCode khớp ngay -> 2 lần gọi (1 tỉnh + 1 phường)", async () => {
    const { a, calls } = adapterWith([{ area_name: "Gò Vấp", area_v2: 13001, ...REGION_AD }]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Gò Vấp");
    assert.equal(r, 13001);
    assert.equal(calls.length, 2, `gọi ${calls.length} lần, mong đợi 2`);
  });

  await check("8. Không có kết quả -> tối đa 6 lần gọi, trả null", async () => {
    const { a, calls } = adapterWith([]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Gò Vấp");
    assert.equal(r, null);
    assert.ok(calls.length <= 6, `gọi ${calls.length} lần, trần là 6`);
  });

  console.log("\n== PHASE 0.6. Nhiều kết quả gần giống trong 1 lần ==");

  await check("9. Lọn kết quả gần giống -> chỉ nhận đúng tên khớp tuyệt đối", async () => {
    // Gateway trả nhiều tin; chỉ đúng 1 tin có tên chuẩn hoá khớp tuyệt đối.
    const { a } = adapterWith([
      { area_name: "Phường 1", area_v2: 13001, ...REGION_AD },
      { area_name: "Phường 11", area_v2: 13011, ...REGION_AD },
      { area_name: "Phường 111", area_v2: 13111, ...REGION_AD },
      { area_name: "Phường 10", area_v2: 13010, ...REGION_AD },
      { area_name: "Quận 6", area_v2: 13006, ...REGION_AD },
    ]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 11");
    assert.equal(r, 13011, "phải lấy đúng Phường 11, không phải Phường 1/10/111");
  });

  await check("10. Toàn bộ kết quả đều gần giống nhưng không khớp -> null", async () => {
    const { a } = adapterWith([
      { area_name: "Phường 1", area_v2: 13001, ...REGION_AD },
      { area_name: "Phường 10", area_v2: 13010, ...REGION_AD },
      { area_name: "Phường 111", area_v2: 13111, ...REGION_AD },
    ]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 11");
    assert.equal(r, null, "không được chọn đại bất kỳ kết quả nào gần giống");
  });

  await check("11. Kết quả đúng nằm SAU các kết quả gần giống -> vẫn thấy", async () => {
    const { a } = adapterWith([
      { area_name: "Phường 1", area_v2: 13001, ...REGION_AD },
      { area_name: "Phường 10", area_v2: 13010, ...REGION_AD },
      { area_name: "Phường 11", area_v2: 13011, ...REGION_AD },
    ]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 11");
    assert.equal(r, 13011);
  });

  await check("12. Cùng tên ở 2 tỉnh khác -> region lọc đúng trước", async () => {
    // "Phường 1" có ở nhiều tỉnh. Nếu không lọc theo region sẽ lấy nhầm mã.
    const { a } = adapterWith([
      { area_name: "Phường 1", area_v2: 21001, region_name: "Hà Nội", region_v2: 44 },
      { area_name: "Phường 1", area_v2: 13001, region_name: "Tp Hồ Chí Minh", region_v2: 79 },
    ]);
    const r = await a.resolveAreaCode("Tp Hồ Chí Minh", "Phường 1");
    assert.equal(r, 13001, "phải lấy mã của Phường 1 ở TP.HCM, không phải Hà Nội");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
