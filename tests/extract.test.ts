// Self-check: chống SSRF + bóc tách HTML. Chạy: npm test
// Dùng assert thuần, không thêm test framework.

import { strict as assert } from "node:assert";
import { assertPublicUrl, safeFetchPage } from "../lib/url-guard.ts";
import { extractListing } from "../lib/html-extract.ts";
import { parseChototId, adToListing } from "../lib/chotot.ts";

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
  console.log("\n== Chặn SSRF (phải bị từ chối) ==");

  const blocked = [
    "file:///etc/passwd",
    "http://127.0.0.1/",
    "http://127.0.0.1:3000/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://172.16.5.4/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://localhost:3000/",
    "http://example.com:22/",
    "gopher://example.com/",
    "not-a-url",
  ];

  for (const url of blocked) {
    await check(`chặn ${url}`, async () => {
      const r = await assertPublicUrl(url);
      assert.equal(r.ok, false, `phải bị chặn, thực tế ${JSON.stringify(r)}`);
    });
  }

  await check("IP công khai thì qua", async () => {
    const r = await assertPublicUrl("https://1.1.1.1/");
    assert.equal(r.ok, true);
  });

  console.log("\n== safeFetchPage báo lý do đúng ==");

  await check("file:// bị chặn (không gọi mạng)", async () => {
    const r = await safeFetchPage("file:///etc/passwd");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "ssrf_blocked");
  });

  await check("IP nội bộ bị chặn (không gọi mạng)", async () => {
    const r = await safeFetchPage("http://169.254.169.254/latest/meta-data/");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "ssrf_blocked");
  });

  console.log("\n== Bóc tách HTML ==");

  const jsonLd = `<!doctype html><html><head>
    <title>Nhà bán gấp Hà Nội 80m2 giá 5.5 tỷ | Mã tin 123</title>
    <meta property="og:title" content="Bán nhà mặt phố Hà Nội, ngân hàng thanh lý, 5.5 tỷ">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Bán nhà 80m2 tại Cầu Giấy, Hà Nội",
     "description":"Nhà 4 tầng, mặt tiền 5m, sổ hồng riêng, nhà cần tiền bán gấp ngân hàng thanh lý khi giá rẻ hơn thị trường 1 tỷ.",
     "address":{"@type":"PostalAddress","addressLocality":"Hà Nội"},
     "floorSize":"80 m2","numberOfRooms":4,
     "offers":{"@type":"Offer","price":"5500000000"}}
    </script></head><body>
    <nav>Trang chủ Tin rao Bản đồ Liên hệ</nav>
    <p>Bán nhà 4 tầng, mặt tiền 5m, ngõ ô tô, cách biển 2km, dân cư đông, giá bán 5,5 tỷ có thương lượng.</p>
    <footer>Copyright 2026</footer></body></html>`;

  await check("JSON-LD được ưu tiên", () => {
    const r = extractListing(jsonLd, "https://example.vn/tin/123");
    assert.equal(r.method, "jsonld");
    assert.match(r.text, /Cầu Giấy/);
    assert.match(r.text, /80 m2/);
    assert.equal(r.priceHint, "5500000000");
    assert.equal(r.domain, "example.vn");
    assert.ok(r.text.length <= 6000, "text phải <= 6000 ký tự");
  });

  await check("bỏ menu/footer lặp lại, giữ nội dung tin", () => {
    const r = extractListing(jsonLd.replace(/<script[\s\S]*?<\/script>/i, ""), "https://example.vn/tin/123");
    assert.doesNotMatch(r.text, /Trang chủ Tin rao/);
    assert.match(r.text, /ngõ ô tô/);
  });

  const metaOnly = `<!doctype html><html><head>
    <title>Đất nền Đà Nẵng 100m2 giá 3 tỷ</title>
    <meta name="description" content="Bán đất nền Đà Nẵng, đường 12m, giá 3 tỷ, sổ riêng, không tranh chấp.">
  </head><body><p>Chi tiết tại văn phòng.</p></body></html>`;

  await check("rơi về og/meta khi không có JSON-LD", () => {
    const r = extractListing(metaOnly, "https://datnha.vn/a");
    assert.notEqual(r.method, "jsonld");
    assert.match(r.text, /Đà Nẵng/);
  });

  const textOnly = `<html><body>
    <p>Bán nhà hẻm 2m phường 8, quận 5, diện tích 45m2, giá 4.2 tỷ, sổ chung, cần tiền gấp.</p>
    <p>Liên hệ chủ nhà sau 18h, không trả phí môi giới.</p>
  </body></html>`;

  await check("chỉ có text thuần vẫn lấy được", () => {
    const r = extractListing(textOnly, "https://x.vn/b");
    assert.match(r.text, /phường 8/);
    assert.match(r.text, /không trả phí/);
  });

  await check("trang rỗng -> text ngắn (UI sẽ báo copy tay)", () => {
    const r = extractListing("<html><body></body></html>", "https://x.vn/c");
    assert.ok(r.text.length < 120, `text quá dài: ${r.text.length}`);
  });

  await check("decode entity &amp; và &lt;", () => {
    const r = extractListing(
      "<html><body><p>Bán nhà 80m2 &amp; 5 phòng, giá &lt; 5 tỷ, sổ hồng riêng, mặt tiền 5m, ngõ xe hơi vào được.</p></body></html>",
      "https://x.vn/d",
    );
    assert.match(r.text, /&/);
    assert.doesNotMatch(r.text, /&amp;/);
  });

  console.log("\n== Link tin Chợ Tốt / Nhà Tốt ==");

  await check("tách ID từ link tin chi tiết nhatot", () => {
    assert.equal(
      parseChototId("https://www.nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh/134384271.htm"),
      "134384271",
    );
  });

  await check("tách ID khi có query/fragment", () => {
    assert.equal(
      parseChototId("https://www.nhatot.com/mua-ban-nha-dat/134824296.htm#px=SR-1?utm=x"),
      "134824296",
    );
  });

  await check("trang danh sách/khác domain -> null (đi đường fetch thường)", () => {
    assert.equal(parseChototId("https://www.nhatot.com/mua-ban-nha-dat"), null);
    assert.equal(parseChototId("https://batdongsan.com.vn/nha-dat-ban/123.htm"), null);
    assert.equal(parseChototId("not-a-url"), null);
  });

  const adFixture = {
    subject: "NHÀ RIÊNG NGUYỄN KIỆM - PHÁP LÝ RÕ - GIÁ 4,75 TỶ",
    body: "Chính chủ bán nhà tại Nguyễn Kiệm, sổ riêng, nhà 2 tầng khang trang, diện tích 27m2, giá 4,75 tỷ, thương lượng trực tiếp với khách thiện chí.",
    price_string: "4,75 tỷ",
    price: 4750000000,
    size: 27,
    street_name: "Đường Nguyễn Kiệm",
    ward_name: "Phường 3",
    area_name: "Quận Gò Vấp",
    region_name: "Tp Hồ Chí Minh",
    rooms: 2,
    floors: 1,
  };

  await check("adToListing ghép đủ tiêu đề/mô tả/giá/diện tích/địa chỉ", () => {
    const r = adToListing(adFixture, "https://www.nhatot.com/mua-ban-nha-dat/134384271.htm");
    assert.ok(r, "phải bóc được");
    assert.equal(r!.method, "gateway");
    assert.match(r!.text, /NGUYỄN KIỆM/);
    assert.match(r!.text, /4,75 tỷ/);
    assert.match(r!.text, /27 m²/);
    assert.match(r!.text, /Quận Gò Vấp/);
    assert.equal(r!.priceHint, "4,75 tỷ");
    assert.equal(r!.areaHint, "27 m²");
    assert.equal(r!.domain, "nhatot.com");
    assert.ok(r!.text.length >= 120, "text phải đủ dài để chấm điểm");
  });

  await check("ad thiếu subject/body -> null", () => {
    assert.equal(adToListing({ price: 1 }, "https://www.nhatot.com/x/1.htm"), null);
  });

  console.log("\n== Bóc __NEXT_DATA__ (trang Next.js) ==");

  const nextDataPage = `<!doctype html><html><head><title>Tin BĐS Quận 7</title>
    <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"ad":{
      "subject":"Bán nhà gấp Quận 7 giá 3 tỷ",
      "body":"Nhà 3 tầng mặt tiền đường số 12, diện tích 60m2, sổ hồng riêng đầy đủ, cần tiền bán gấp trong tuần này, khách thiện chí thương lượng."}}}}</script>
    </head><body><div id="__next"></div></body></html>`;

  await check("__NEXT_DATA__ được bóc khi không có JSON-LD", () => {
    const r = extractListing(nextDataPage, "https://www.chotot.com/tin/999");
    assert.equal(r.method, "nextdata");
    assert.match(r.text, /Quận 7/);
    assert.match(r.text, /60m2/);
    assert.ok(r.text.length >= 120, "text phải đủ dài để chấm điểm");
  });

  await check("JSON-LD vẫn ưu tiên hơn __NEXT_DATA__", () => {
    const both = jsonLd.replace(
      "</head>",
      `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"ad":{"subject":"Tin khác","body":"Nội dung khác dài hơn hai mươi lăm ký tự để qua ngưỡng lọc chuỗi."}}}}</script></head>`,
    );
    const r = extractListing(both, "https://example.vn/tin/123");
    assert.equal(r.method, "jsonld");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail\n`);
  if (fail > 0) process.exitCode = 1;
}

void main();
