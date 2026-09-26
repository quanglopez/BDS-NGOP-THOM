// Verify live endpoints. BASE có thể override qua biến môi trường:
// BASE=https://checkbds.online node tests/verify-live.ts
export {};
const ENV_BASE =
  typeof process !== "undefined" && typeof process.env.BASE === "string" ? process.env.BASE : "";
const BASE = ENV_BASE || "https://check-bds-ngop.vercel.app";
const ORIGIN = BASE;

async function post(path: string, body: unknown) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  return `${r.status} ${t.slice(0, 220)}`;
}

async function get(path: string) {
  const r = await fetch(BASE + path, { headers: { Origin: ORIGIN } });
  const t = await r.text();
  return `${r.status} len=${t.length}`;
}

console.log("homepage  ", await get("/"));
console.log("pricing   ", await get("/pricing"));
console.log("extract ok", await post("/api/extract", { url: "https://example.com" }));
console.log("ssrf loop ", await post("/api/extract", { url: "http://127.0.0.1:22" }));
console.log("ssrf meta ", await post("/api/extract", { url: "http://169.254.169.254/latest/meta-data/" }));
console.log("ssrf file ", await post("/api/extract", { url: "file:///etc/passwd" }));
console.log("no url    ", await post("/api/extract", {}));
console.log("lead honey", await post("/api/leads", { email: "bot@spam.example", website: "http://spam" }));
console.log("lead bad  ", await post("/api/leads", { email: "khong-phai-email" }));

// CORS: origin la
const r = await fetch(BASE + "/api/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
  body: JSON.stringify({ url: "https://example.com" }),
});
console.log("cors evil ", r.status, r.headers.get("access-control-allow-origin") ?? "(no ACAO header)");
