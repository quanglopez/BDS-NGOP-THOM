// Bóc tách nội dung tin rao từ HTML tĩnh (không dùng thư viện ngoài).
// Ưu tiên JSON-LD -> og/meta -> text thuần trong thẻ.

export interface ExtractedListing {
  title: string;
  text: string;
  priceHint: string | null;
  areaHint: string | null;
  method: "jsonld" | "nextdata" | "gateway" | "meta" | "text";
  domain: string;
}

const MAX_TEXT = 6000; // khớp giới hạn state của Jev
const MIN_USABLE = 80;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "...",
  mdash: "-",
  ndash: "-",
  ldquo: '"',
  rdquo: '"',
  laquo: "<<",
  raquo: ">>",
  times: "x",
  m2: "m2",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z0-9]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

export function collapse(input: string): string {
  return input.replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const v = collapse(decodeEntities(m[1].replace(/<[^>]+>/g, " ")));
      if (v) return v;
    }
  }
  return null;
}

function getTitle(html: string): string {
  return (
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([\s\S]{1,300}?)<\/title>/i,
      /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i,
    ]) ?? "Tin bất động sản"
  );
}

// Gom mọi node JSON-LD (kể cả @graph) rồi tìm node mô tả bất động sản
function collectJsonLd(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const push = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(push);
        else if (v && typeof v === "object") nodes.push(v as Record<string, unknown>);
      };
      push(parsed);
    } catch {
      // JSON-LD hỏng -> bỏ qua, thử phương án khác
    }
  }
  return nodes;
}

const REALESTATE_TYPES = new Set([
  "product",
  "residence",
  "apartment",
  "house",
  "singlefamilyresidence",
  "realestatelisting",
  "apartmentlisting",
  "offer",
  "place",
  "webpage",
  "article",
]);

function typesOf(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  if (typeof raw === "string") return [raw.toLowerCase()];
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === "string").map((t) => String(t).toLowerCase());
  return [];
}

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return str(obj.name ?? obj["@id"] ?? obj.value ?? "");
  }
  return "";
}

function findJsonLd(html: string): { text: string; price: string | null; area: string | null } | null {
  const nodes = collectJsonLd(html).filter((n) => typesOf(n).some((t) => REALESTATE_TYPES.has(t)));
  if (nodes.length === 0) return null;

  const parts: string[] = [];
  let price: string | null = null;
  let area: string | null = null;

  for (const node of nodes) {
    const name = str(node.name) || str(node.headline) || str(node.title);
    const desc = str(node.description);
    const address = str((node.address as Record<string, unknown>) ?? {}) || str(node.address);
    const floor = str(node.floorSize) || str(node.floorArea) || str(node.areaServed);
    const rooms = str(node.numberOfRooms);
    const offers = node.offers as Record<string, unknown> | undefined;
    const offerPrice = offers ? str(offers.price ?? offers.lowPrice ?? offers.highPrice) : "";
    const url = str(node.url);

    if (name) parts.push(name);
    if (desc) parts.push(desc);
    if (address) parts.push(`Địa chỉ: ${address}`);
    if (floor) parts.push(`Diện tích: ${floor}`);
    if (rooms) parts.push(`Số phòng: ${rooms}`);
    if (offerPrice) {
      parts.push(`Giá: ${offerPrice}`);
      price ??= offerPrice;
    }
    if (floor && !area) area = floor;
    if (url && !url.startsWith("http")) continue;
  }

  const text = collapse(parts.join("\n"));
  if (text.length < MIN_USABLE) return null;
  return { text, price, area };
}

// Bóc dữ liệu nhúng của trang Next.js (__NEXT_DATA__): gom mọi chuỗi nội dung
// có nghĩa, bỏ URL/base64/hash kỹ thuật. Cứu được trang render bằng JS mà
// server vẫn tải được HTML (vd trang danh sách Chợ Tốt/Nhà Tốt).
function findNextData(html: string): { text: string; price: string | null; area: string | null } | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;

  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (out.join("\n").length > MAX_TEXT || depth > 8) return;
    if (typeof v === "string") {
      const t = collapse(decodeEntities(v));
      if (
        t.length >= 25 &&
        t.length <= 2000 &&
        /[a-zà-ỹ]/i.test(t) &&
        !/^(https?:|data:|blob:)/i.test(t) &&
        !/^[a-z0-9+/=]{48,}$/i.test(t.replace(/\s+/g, ""))
      ) {
        const key = t.slice(0, 60).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(t.slice(0, 400));
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 60)) walk(item, depth + 1);
      return;
    }
    if (v && typeof v === "object") {
      for (const value of Object.values(v as Record<string, unknown>)) walk(value, depth + 1);
    }
  };
  walk(data, 0);

  const text = collapse(out.join("\n"));
  if (text.length < MIN_USABLE) return null;
  return {
    text,
    price: text.match(/([\d.,]+\s*(?:tỷ|tr|triệu))/i)?.[1] ?? null,
    area: text.match(/(\d+(?:[.,]\d+)?\s*m2)/i)?.[1] ?? null,
  };
}

// Text hiển thị: bỏ script/style, gắn xuống dòng theo thẻ block
function visibleText(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|template)\b[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = collapse(decodeEntities(cleaned))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 25 && /[a-zà-ỹ]/i.test(l));

  // Bỏ dòng lặp lại (menu/footer) và dòng quá dài
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.slice(0, 400));
  }
  return collapse(out.join("\n"));
}

export function extractListing(html: string, url: string): ExtractedListing {
  const domain = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  const title = getTitle(html);

  const ld = findJsonLd(html);
  if (ld) {
    return {
      title,
      text: collapse(`${title}\n${ld.text}`).slice(0, MAX_TEXT),
      priceHint: ld.price,
      areaHint: ld.area,
      method: "jsonld",
      domain,
    };
  }

  const nd = findNextData(html);
  if (nd) {
    return {
      title,
      text: collapse(`${title}\n${nd.text}`).slice(0, MAX_TEXT),
      priceHint: nd.price,
      areaHint: nd.area,
      method: "nextdata",
      domain,
    };
  }

  const meta =
    firstMatch(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ]) ?? "";

  const body = visibleText(html);
  if (body.length >= MIN_USABLE) {
    return {
      title,
      text: collapse(`${title}\n${meta ? `${meta}\n` : ""}${body}`).slice(0, MAX_TEXT),
      priceHint: meta.match(/([\d.,]+\s*(?:tỷ|tr|triệu))/i)?.[1] ?? null,
      areaHint: meta.match(/(\d+\s*m2)/i)?.[1] ?? null,
      method: meta ? "meta" : "text",
      domain,
    };
  }

  // Không đủ nội dung -> trả phần có được để UI tự thông báo
  return {
    title,
    text: collapse(`${title}\n${meta}`).slice(0, MAX_TEXT),
    priceHint: null,
    areaHint: null,
    method: "text",
    domain,
  };
}
