// Debug: xem tin "cho thue" lot vao category-scan la gi (tam)
export {};
const BASE = "https://check-bds-ngop.vercel.app";
const r = await fetch(BASE + "/api/category-scan", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({
    url: "https://www.nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh",
  }),
});
const j = await r.json();
for (const i of j.items as { title: string; priceHint: string; ward: string }[]) {
  if (/cho thu[eê]/i.test(i.title)) console.log("RENT?:", i.title.slice(0, 80), "|", i.priceHint, "|", i.ward);
}
// Xem truc tiep gateway type cua cac tin nay
const g = await fetch(
  "https://gateway.chotot.com/v1/public/ad-listing?cg=1020&limit=50&page=1&q=go%20vap",
  { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 Chrome/122.0" } },
);
const gj = await g.json();
for (const a of gj.ads as { subject: string; type: string; price_string: string }[]) {
  if (/cho thu[eê]/i.test(a.subject ?? "")) {
    console.log("GW:", JSON.stringify((a.subject ?? "").slice(0, 70)), "| type=", a.type, "|", a.price_string);
  }
}
