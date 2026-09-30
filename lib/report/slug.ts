// Slug SEO cho URL báo cáo: /bao-cao/{slug}-{shortId}.
//
// Ràng buộc quan trọng: route vẫn là /bao-cao/[id] (một param duy nhất).
// Param nhận CẢ UUID lẫn slug, nên URL cũ không hỏng và không cần
// migration DB — slug được tính lại từ dữ liệu report khi render.
//
// Thuật toán bỏ dấu tiếng Việt bằng NFD + \p{M}, KHÔNG dùng bảng tra
// cứng: bảng tra dễ lệch ("đ" vs "d", "ơ"/"ư") và cần bảo trì khi thêm
// chữ. Kiểm thử khoá hành vi.

/** Bỏ dấu + lowercase + gộp khoảng trắng, CHƯA nối bằng "-". */
function deaccent(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "") // dấu thanh/dấu phụ tách rời khỏi ký tự gốc
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Chuẩn hoá chuỗi thành slug an toàn cho URL:
 * bỏ dấu tiếng Việt, lowercase, ký tự lạ -> "-", gộp "-", cắt đầu/cuối.
 */
export function slugify(input: string): string {
  return deaccent(input)
    .replace(/[^a-z0-9]+/g, "-") // mọi thứ không phải [a-z0-9] gộp thành "-"
    .replace(/-{2,}/g, "-") // "a -- b" -> "a-b"
    .replace(/^-+|-+$/g, ""); // cắt "-" thừa hai đầu
}

/** Loại bỏ phần mô tả dài, giữ tối đa `maxWords` từ đầu. */
function limitWords(text: string, maxWords: number): string {
  return text
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

export interface ReportSlugInput {
  /** Tiêu đề / dòng đầu của nội dung tin. */
  title: string | null | undefined;
  /** Tỉnh/thành. */
  province: string | null | undefined;
  /** Giá chào bán (VND). Dùng để tạo mã "4-3-ty". */
  price: number | null | undefined;
  /** UUID đầy đủ của report — dùng để tạo shortId. */
  id: string;
}

/** "4.300.000.000" -> "4-3-ty". null nếu không có giá. */
function priceSegment(price: number | null | undefined): string | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  // Tỷ, làm tròn 1 chữ số thập phân rồi bỏ số 0 thừa: 4,3 tỷ -> "4-3-ty".
  const billions = price / 1_000_000_000;
  if (billions < 1) return null; // dưới 1 tỷ thì không đưa giá vào slug
  const rounded = Math.round(billions * 10) / 10;
  const [int, frac] = String(rounded).split(".");
  const core = frac ? `${int}-${frac}` : int;
  return `${core}-ty`;
}

/**
 * shortId 6 ký tự từ UUID. Cắt bằng base36 trên dải hex đầu để giữ tính
 * phân bố đều, tránh dùng uuid[0:6] (tập trung ở ký tự đầu theo version).
 */
export function shortId(id: string, len = 6): string {
  const hex = id.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length === 0) return "";
  let acc = 0;
  for (let i = 0; i < 8 && i < hex.length; i++) {
    acc = (acc * 31 + parseInt(hex[i], 16)) >>> 0;
  }
  return acc.toString(36).padStart(len, "0").slice(-len);
}

/**
 * Dựng slug đầy đủ: "{slug}-{shortId}".
 * shortId luôn nối bằng "-", kể cả khi phần mô tả rỗng.
 */
export function buildReportSlug(input: ReportSlugInput): string {
  const parts: string[] = [];
  const title = slugify(limitWords(input.title ?? "", 12));
  if (title) parts.push(title);
  const province = slugify(input.province ?? "");
  if (province) parts.push(province);
  const price = priceSegment(input.price);
  if (price) parts.push(price);
  const sid = shortId(input.id);
  // Không có shortId thì slug vẫn dùng được nhưng KHÔNG phải URL báo cáo
  // hợp lệ — caller phải tự quyết định fallback sang UUID.
  return [...parts, sid].filter(Boolean).join("-");
}

/**
 * Khoá truy cập vào report từ URL. Nhận UUID hoặc slug.
 * Trả về checkId nếu `ref` khớp UUID, hoặc shortId nếu là slug.
 */
export function isUuid(ref: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
}


/** Trả về shortId hoặc null nếu không phải slug report. */
export function shortIdFromSlug(slug: string): string | null {
  const m = /-([a-z0-9]{6})$/.exec(slug.toLowerCase());
  return m ? m[1] : null;
}

/**
 * Khoá truy cập report từ tham số route. Route là /bao-cao/[id] — MỘT
 * param duy nhất nhận cả hai dạng, nên URL cũ không hỏng và không cần
 * thêm route.
 */
export type ReportRef =
  | { kind: "uuid"; id: string }
  | { kind: "slug"; slug: string; shortId: string };

export function parseReportRef(ref: string): ReportRef | null {
  const raw = ref.trim();
  if (!raw) return null;
  if (isUuid(raw)) return { kind: "uuid", id: raw.toLowerCase() };
  const sid = shortIdFromSlug(raw);
  if (sid) return { kind: "slug", slug: raw.toLowerCase(), shortId: sid };
  return null;
}

/**
 * URL báo cáo để share. Ưu tiên slug đã lưu; report cũ (seo_slug null)
 * rơi về UUID — luôn mở được.
 */
export function reportUrl(id: string, seoSlug: string | null | undefined): string {
  return `/bao-cao/${seoSlug && seoSlug.length > 0 ? seoSlug : id}`;
}
