// Phân tích URL danh mục Chợ Tốt / Nhà Tốt (vd mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh)
// -> { kind, wardSlug, provinceName }. URL tin chi tiết (đuôi /<id>.htm) trả null.

import { norm, PROVINCES } from "@/lib/provinces";

export type CategoryKind = "nha-o" | "dat" | "can-ho" | "nha-dat";

export interface CategorySlug {
  kind: CategoryKind;
  kindLabel: string;
  wardSlug: string | null;
  provinceName: string | null;
}

const KIND_MAP: { key: string; kind: CategoryKind; label: string }[] = [
  { key: "can-ho", kind: "can-ho", label: "Căn hộ/Chung cư" },
  { key: "chung-cu", kind: "can-ho", label: "Căn hộ/Chung cư" },
  { key: "nha-dat", kind: "nha-dat", label: "Nhà đất" },
  { key: "nha-o", kind: "nha-o", label: "Nhà ở" },
  { key: "dat-nen", kind: "dat", label: "Đất" },
  { key: "dat", kind: "dat", label: "Đất" },
  { key: "nha", kind: "nha-o", label: "Nhà ở" },
];

const HOST_RE = /(^|\.)(nhatot\.com|chotot\.com)$/;

// Tiền tố hành chính để lột khi khớp tên quận/phường
const ADMIN_PREFIX = /^(quan|huyen|thi-xa|thanh-pho|tp|phuong|xa|thi-tran|khu-pho)-(.+)$/;

// Danh sách rút gọn các đơn vị cấp quận/huyện thường gặp (slug đã chuẩn hóa)
// Dùng để tách đoạn ward khỏi đoạn province trong URL danh mục.
const WARD_HINTS = new Set([
  "quan", "huyen", "thi-xa", "thanh-pho", "tp", "phuong", "xa", "thi-tran",
]);

function countyHint(seg: string): boolean {
  const first = seg.split("-")[0];
  return WARD_HINTS.has(first);
}

export function parseCategoryUrl(raw: string): CategorySlug | null {
  let host: string;
  let path: string;
  try {
    const u = new URL(raw.trim());
    host = u.hostname.toLowerCase();
    path = u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
  if (!HOST_RE.test(host)) return null;
  // URL tin chi tiết thì không phải danh mục (để /api/extract xử lý)
  if (/\/\d{5,15}\.htm$/.test(path)) return null;

  // Đoạn cuối path thường là slug danh mục: /mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh
  const slug = (path.split("/").filter(Boolean).pop() ?? "").toLowerCase();
  if (!slug || slug.length < 6) return null;

  // Nhánh loại: lấy nhánh trái nhất khớp
  const kindHit = KIND_MAP.find((k) => norm(slug).includes(norm(k.key)));
  if (!kindHit) return null;

  // Bỏ tiền tố mua-ban / cho-thue để còn "nha-dat-quan-go-vap-tp-ho-chi-minh"
  const rest = slug
    .replace(/^(mua-ban|ban|cho-thue|thue)-/, "")
    .replace(new RegExp(`^${kindHit.key}-?`), "");

  // Tách ward và province: khớp đuôi dài nhất là tên tỉnh
  let provinceName: string | null = null;
  let wardSlug: string | null = null;
  if (rest) {
    const found = findProvinceSuffix(norm(rest));
    if (found) {
      provinceName = found.province;
      wardSlug = found.ward || null;
    } else if (countyHint(rest)) {
      // Toàn đoạn là quận nhưng chưa rõ tỉnh -> chỉ có ward
      wardSlug = rest;
    }
  }

  return {
    kind: kindHit.kind,
    kindLabel: kindHit.label,
    wardSlug,
    provinceName,
  };
}

// Tìm đuôi là tên tỉnh trong slug: điểm cắt càng trái càng tốt (ward ngắn gọn),
// nhưng đuôi tỉnh phải khớp đúng ranh từ (không khớp nửa chừng như "vinh" trong "vinh-yen")
function findProvinceSuffix(rest: string): { province: string; ward: string } | null {
  const segs = rest.split("-");
  // Điểm cắt trái nhất có đuôi là tên tỉnh và ward hợp lệ (rỗng hoặc bắt đầu
  // bằng đơn vị hành chính). Quét hết để đuôi tỉnh dài hơn thắng đuôi ngắn hơn
  // (vd "tp-ho-chi-minh" thắng "ho-chi-minh").
  let best: { province: string; ward: string } | null = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const tail = segs.slice(i).join("-");
    const province = matchProvinceTail(tail);
    if (!province) continue;
    const ward = segs.slice(0, i).join("-");
    best = { province, ward };
    if (i > 0 && !countyHint(ward)) continue;
    best = { province, ward };
    // Không return ngay: còn có thể có đuôi tỉnh dài hơn ở điểm cắt trái hơn
    // nhưng chỉ nhận nếu ward vẫn hợp lệ
    let better: { province: string; ward: string } | null = null;
    // Chỉ xét điểm cắt còn ward (j>0); j=0 (trọn rest là tên tỉnh) không bao giờ
    // tốt hơn điểm đã có vì nó nuốt luôn cả quận
    for (let j = i - 1; j > 0; j--) {
      const p2 = matchProvinceTail(segs.slice(j).join("-"));
      if (!p2) continue;
      const w2 = segs.slice(0, j).join("-");
      if (j === 0 || countyHint(w2)) better = { province: p2, ward: w2 };
    }
    return better ?? best;
  }
  return best;
}

// Khớp đuôi slug với tên tỉnh đã chuẩn hóa (bỏ dấu, nối "-")
const PROVINCE_SLUGS: { slug: string; label: string }[] = (() => {
  const out: { slug: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const label of PROVINCES as readonly string[]) {
    const slug = norm(label).replace(/\s+/g, "-");
    if (!seen.has(slug)) {
      seen.add(slug);
      out.push({ slug, label });
    }
  }
  // Alias hay gặp: TP.HCM viết dạng khác
  out.push({ slug: "tp-ho-chi-minh", label: "TP.HCM" });
  out.push({ slug: "ho-chi-minh", label: "TP.HCM" });
  out.push({ slug: "sai-gon", label: "TP.HCM" });
  out.push({ slug: "ba-ria-vung-tau", label: "Vũng Tàu" });
  return out.sort((a, b) => b.slug.length - a.slug.length);
})();

function matchProvinceTail(tail: string): string | null {
  // Khớp đúng toàn bộ đuôi với tên tỉnh (không endsWith: "vap-tp-ho-chi-minh"
  // cũng endsWith tên tỉnh nhưng ward của nó đã nuốt mất chữ "tp")
  const t = norm(tail).replace(/-/g, " ").replace(/\s+/g, " ").trim();
  for (const p of PROVINCE_SLUGS) {
    const s = norm(p.slug).replace(/-/g, " ").replace(/\s+/g, " ").trim();
    if (t === s) return p.label;
  }
  return null;
}

export function stripAdminPrefix(slug: string): string {
  const m = slug.match(ADMIN_PREFIX);
  return m ? m[2] : slug;
}
