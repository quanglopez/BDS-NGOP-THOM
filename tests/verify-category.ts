// Verify live category-scan (tam)
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
console.log("status:", r.status);
console.log("ok:", j.ok, "| reason:", j.reason ?? "-");
if (j.ok) {
  console.log("scope:", JSON.stringify(j.scope));
  console.log("items:", j.items.length, "| limit:", j.limit, "| truncated:", j.truncated);
  const first = j.items[0];
  console.log("first:", first.title.slice(0, 70));
  console.log("  price:", first.priceHint, "| area:", first.areaHint, "| ward:", first.ward);
  console.log("  text len:", first.text.length);
  console.log("  any rent leaked:", j.items.some((i: { title: string }) => /cho thu[eê]/i.test(i.title)));
}
