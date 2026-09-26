// Self-check: chống SSRF + bóc tách HTML. Chạy: npm test
// Dùng assert thuần, không thêm test framework.

import { strict as assert } from "node:assert";
import { assertPublicUrl, safeFetchPage } from "../lib/url-guard.ts";
import { extractListing } from "../lib/html-extract.ts";

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

  console.log(`\nKết quả: ${pass} pass, ${fail} fail\n`);
  if (fail > 0) process.exitCode = 1;
}

void main();
