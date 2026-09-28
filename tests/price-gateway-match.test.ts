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
  /** Gateway trả tên phường/xã ở field riêng, KHÔNG nằm trong area_name. */
  ward_name?: string;
  /** Mã phường. Khác `area_v2` (mã quận). Có thể thiếu. */
  ward?: unknown;
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

  console.log("\n== PHASE 0.7. Tên PHƯỜNG nằm ở ad.ward_name, không phải ad.area_name ==");

  // Tin thật trên production: ad.ward_name = "Phường An Hải Bắc" còn
  // ad.area_name = "Quận Sơn Trà". Trước đây chỉ so với area_name nên tên
  // phường luôn trượt -> scope rơi về tỉnh.
  const DA_NANG_AD = { region_name: "Đà Nẵng", region_v2: 3017 };
  const AN_HAI_BAC_AD = {
    ward_name: "Phường An Hải Bắc",
    area_name: "Quận Sơn Trà",
    area_v2: 30402,
    ...DA_NANG_AD,
  };

  await check("13. Khớp ad.ward_name, tin KHÔNG có mã ward -> trả area_v2", async () => {
    const { a } = adapterWith([AN_HAI_BAC_AD]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 30402, "phải resolve được từ ward_name dù area_name là tên quận");
  });

  await check("14. ward_name khác, area_name khớp -> vẫn trả (fallback cũ giữ nguyên)", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường Hòa Hải", area_name: "Quận Ngũ Hành Sơn", area_v2: 30403, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Quận Ngũ Hành Sơn");
    assert.equal(r, 30403, "tên quận vẫn phải tra được qua area_name");
  });

  await check("15. Tin khớp qua ward_name nằm sau tin không khớp -> vẫn thấy", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường Mỹ An", area_name: "Quận Ngũ Hành Sơn", area_v2: 30403, ...DA_NANG_AD },
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", area_v2: 30402, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 30402, "phải quét hết để tìm tin có ward_name khớp");
  });

  await check("15b. area_name trùng tên phường (bỏ prefix) cũng khớp", async () => {
    // "An Hải Bắc" và "Phường An Hải Bắc" chuẩn hoá ra cùng chuỗi -> cùng một
    // địa danh, nhận là hợp lệ. Đây là hành vi cố ý, không phải khớp chéo.
    const { a } = adapterWith([
      { ward_name: "Phường Mỹ An", area_name: "An Hải Bắc", area_v2: 30402, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 30402, "tên không có prefix là cùng địa danh sau chuẩn hoá");
  });

  await check("16. Chống chéo số trên ward_name: 'Phường 11' != 'Phường 1'", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường 1", area_name: "Quận 1", area_v2: 30401, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường 11");
    assert.equal(r, null, "TUYỆT ĐỐI không được trả mã Phường 1 khi hỏi Phường 11");
  });

  await check("17. Chống chéo số trên ward_name: 'Xã 2' != 'Xã 12'", async () => {
    const { a } = adapterWith([
      { ward_name: "Xã 12", area_name: "Huyện Yên Thành", area_v2: 30412, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Xã 2");
    assert.equal(r, null, "không được trả mã Xã 12 khi hỏi Xã 2");
  });

  await check("18. Chống chéo chiều ngược trên ward_name: 'Phường 1' != 'Phường 11'", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường 11", area_name: "Quận 11", area_v2: 30411, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường 1");
    assert.equal(r, null, "chiều ngược cũng phải trượt");
  });

  await check("19. Lọc tỉnh vẫn áp khi khớp qua ward_name", async () => {
    // Cùng tên phường ở 2 tỉnh. Khớp qua ward_name nhưng tỉnh khác -> phải bỏ.
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận 1", area_v2: 21001, region_name: "Hà Nội", region_v2: 44 },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, null, "tin cùng tên ở tỉnh khác không được dùng");
  });

  await check("20. Khớp ward ở đúng tỉnh khi có tin cùng tên ở tỉnh khác", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận 1", area_v2: 21001, region_name: "Hà Nội", region_v2: 44 },
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", area_v2: 30402, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 30402, "phải lấy mã của Đà Nẵng");
  });

  await check("21. Tin không có ward_name -> hành vi cũ (chỉ area_name)", async () => {
    const { a } = adapterWith([{ area_name: "Quận Sơn Trà", area_v2: 30402, ...DA_NANG_AD }]);
    assert.equal(await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc"), null, "không có ward -> trượt an toàn");
    assert.equal(await a.resolveAreaCode("Đà Nẵng", "Quận Sơn Trà"), 30402, "tên quận vẫn khớp");
  });

  await check("22. ward_name rỗng -> không được khớp bằng so khớp chuỗi rỗng", async () => {
    const { a } = adapterWith([{ ward_name: "", area_name: "Quận Sơn Trà", area_v2: 30402, ...DA_NANG_AD }]);
    const r = await a.resolveAreaCode("Đà Nẵng", "");
    assert.equal(r, null, "tên rỗng không được khớp field rỗng");
  });

  await check("23. Khớp qua ward vẫn tốn đúng 2 lần gọi (1 tỉnh + 1 vòng)", async () => {
    const { a, calls } = adapterWith([AN_HAI_BAC_AD]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 30402);
    assert.equal(calls.length, 2, `gọi ${calls.length} lần, mong đợi 2 (không thêm vòng riêng cho ward)`);
  });

  console.log("\n== PHASE 0.8. Mã trả về phải theo CẤP đã khớp (phường vs quận) ==");

  // Đúng dữ liệu probe live từ gateway (cg=1010, region_v2=3017, q=an+hai+bac):
  //   area_name "Quận Sơn Trà" / area_v2 301704  (mã QUẬN)
  //   ward_name "Phường An Hải Bắc" / ward 6885  (mã PHƯỜNG)
  // Trả 301704 cho tên phường là lưu mã quận vào scope gắn nhãn "phường".
  await check("24. Khớp ward_name -> trả mã ward (6885), KHÔNG phải area_v2", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", ward: 6885, area_v2: 301704, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 6885, "phải trả mã PHƯỜNG");
    assert.notEqual(r, 301704, "TUYỆT ĐỐI không được trả mã quận cho tên phường");
  });

  await check("25. Khớp ward_name nhưng KHÔNG có ward -> lùi về area_v2", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", area_v2: 301704, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, 301704, "thiếu mã phường thì lấy mã quận còn hơn trượt hẳn");
  });

  await check("26. ward không hợp lệ (0 / âm / chuỗi) -> lùi về area_v2", async () => {
    for (const bad of [0, -5, "6885", null, undefined]) {
      const { a } = adapterWith([
        { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", ward: bad, area_v2: 301704, ...DA_NANG_AD },
      ]);
      const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
      assert.equal(r, 301704, `ward=${JSON.stringify(bad)} phải bị loại, lùi về mã quận`);
    }
  });

  await check("27. Khớp area_name -> trả area_v2, KHÔNG dùng ward", async () => {
    // Tin có ward nhưng đang hỏi tên QUẬN -> phải trả mã quận.
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", ward: 6885, area_v2: 301704, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Quận Sơn Trà");
    assert.equal(r, 301704, "tên quận phải ra mã quận");
  });

  await check("28. Cùng quận, 2 phường khác nhau -> 2 mã ward khác nhau", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", ward: 6885, area_v2: 301704, ...DA_NANG_AD },
    ]);
    const a2 = adapterWith([
      { ward_name: "Phường Nại Hiên Đông", area_name: "Quận Sơn Trà", ward: 6886, area_v2: 301704, ...DA_NANG_AD },
    ]);
    assert.equal(await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc"), 6885);
    assert.equal(await a2.a.resolveAreaCode("Đà Nẵng", "Phường Nại Hiên Đông"), 6886);
  });

  await check("29. ward=0 bị loại, mã quận vẫn dùng được (không sinh scope_key rác)", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", ward: 0, area_v2: 301704, ...DA_NANG_AD },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.notEqual(r, 0, "không bao giờ trả mã 0");
    assert.equal(r, 301704);
  });

  await check("30. Chống chéo số vẫn đúng khi có mã ward", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường 1", area_name: "Quận 1", ward: 6885, area_v2: 301701, ...DA_NANG_AD },
    ]);
    assert.equal(await a.resolveAreaCode("Đà Nẵng", "Phường 11"), null, "'Phường 11' không được lấy mã Phường 1");
    const a2 = adapterWith([
      { ward_name: "Xã 12", area_name: "Huyện Yên Thành", ward: 6887, area_v2: 301712, ...DA_NANG_AD },
    ]);
    assert.equal(await a2.a.resolveAreaCode("Đà Nẵng", "Xã 2"), null, "'Xã 2' không được lấy mã Xã 12");
  });

  await check("31. Lọc tỉnh vẫn áp khi khớp ward và có mã ward", async () => {
    const { a } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận 1", ward: 21001, region_name: "Hà Nội", region_v2: 44 },
    ]);
    const r = await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc");
    assert.equal(r, null, "tin cùng tên ở tỉnh khác không được dùng");
  });

  await check("32. Ngân sách gọi giữ nguyên khi dùng mã ward", async () => {
    const { a, calls } = adapterWith([
      { ward_name: "Phường An Hải Bắc", area_name: "Quận Sơn Trà", ward: 6885, area_v2: 301704, ...DA_NANG_AD },
    ]);
    assert.equal(await a.resolveAreaCode("Đà Nẵng", "Phường An Hải Bắc"), 6885);
    assert.equal(calls.length, 2, `gọi ${calls.length} lần, mong đợi 2`);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
