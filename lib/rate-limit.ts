// Rate limit theo IP. Ưu tiên Upstash Redis qua REST nếu có env, không có thì dùng bộ nhớ tạm
// (best-effort trên serverless: mỗi instance riêng, chỉ cần chặn flood ngắn hạn).

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 90; // 90 request/phút/IP — Bulk Check 100 tin chạy 2 luồng vẫn tho

type Bucket = { count: number; resetAt: number };

const memory = new Map<string, Bucket>();

function hitMemory(key: string, limit: number) {
  const now = Date.now();
  const bucket = memory.get(key);

  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_SECONDS * 1000 };
  }

  bucket.count += 1;
  if (memory.size > 5000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

async function hitUpstash(key: string, limit: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;

  const res = await fetch(
    `${url}/pipeline`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, WINDOW_SECONDS],
        ["TTL", key],
      ]),
      cache: "no-store",
    },
  );

  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = (await res.json()) as Array<{ result: number | null }>;
  const count = Number(data[0]?.result ?? 1);
  const ttl = Number(data[2]?.result ?? WINDOW_SECONDS);

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + ttl * 1000,
  };
}

// IP lấy từ header do Vercel/Cloudflare gắn vào
export function clientIp(req: Request): string {
  const headers = req.headers;
  return (
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function checkRateLimit(ip: string, limit = DEFAULT_LIMIT, scope = "check") {
  const key = `ratelimit:${scope}:${ip}`;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await hitUpstash(key, limit);
    } catch (e) {
      console.error(`[rate-limit] Upstash lỗi, dùng fallback bộ nhớ: ${(e as Error).message}`);
    }
  }

  return hitMemory(key, limit);
}
