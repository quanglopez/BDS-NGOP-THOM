// So sánh 2 tin BĐS (PHASE 7) — đối chiếu câu chữ giữa hai nội dung.
//
// THUẦN + ĐỒNG BỘ: không fetch, không await, không Supabase, không React.
// Cùng input -> cùng output.
//
// Học thuyết cốt lõi:
//   bằng chứng giống nhau  !=  cùng một tài sản
//   chênh lệch giá          !=  giá sai
//   cùng số điện thoại      !=  cùng người bán
//   cùng dự án              !=  cùng căn
// Tool trả lời câu hỏi hẹp: hai tin giống/khác nhau ở ĐÂU theo câu chữ,
// và nên đối chiếu gì trước khi coi chúng là liên quan. Thà bỏ sót (LOW)
// hơn là nhận nhầm.
//
// KHÔNG có tín hiệu STRONG đơn lẻ. HIGH chỉ đạt bằng TỔNG HỢP: >= 3 đơn vị
// MEDIUM độc lập, trong đó phải có ngữ cảnh vị trí (dự án hoặc cụm vị trí),
// và không có mâu thuẫn nào.
//
// Điện thoại và URL bị LOẠI khỏi mọi bằng chứng: không dùng làm nhận diện,
// không đếm vào phần so sánh câu chữ.

import {
  normalizeListing,
  normalizeWithMap,
  precededByAny,
  tokenize,
  type NormalizedListing,
} from "@/lib/owner-signals/normalize";
import { extractAreaM2 } from "@/lib/area";
import { extractBedrooms } from "@/lib/bedrooms";
import { detectProvince } from "@/lib/provinces";
import {
  analyzePrices,
  formatVndShort,
  pctText,
  type PriceParse,
  type PriceSpan,
} from "./prices";
import {
  BANNER_TEXT,
  CHECKLIST,
  LEVEL_EXPLANATION,
  LEVEL_LABEL,
  LIMITATION,
  PRICE_EQUAL_TEXT,
  PRICE_UNAVAILABLE_NOTE,
  areaDiff,
  areaLabel,
  bedroomsDiff,
  bedroomsLabel,
  locationLabel,
  priceDiffLine,
  priceLine,
  pricePctLine,
  projectDiff,
  projectLabel,
  provinceDiff,
  spanLabel,
  towerDiff,
  type DuplicateLevel,
} from "./wording";

export const MIN_TEXT_LENGTH = 20;
export const MAX_TEXT_LENGTH = 1000;

export interface SharedUnit {
  kind: "project" | "location_phrase" | "area" | "bedrooms" | "text_span";
  text: string;
}

export interface Contradiction {
  severity: "major" | "minor";
  text: string;
}

export interface PriceView {
  status: "compared" | "equal" | "unavailable";
  lines: string[];
}

export interface DuplicateCheckResult {
  level: DuplicateLevel;
  levelLabel: string;
  explanation: string;
  /** Số đơn vị bằng chứng MEDIUM độc lập. Không phải điểm, không phải %. */
  count: number;
  shared: SharedUnit[];
  /** Major trước, minor sau. */
  contradictions: Contradiction[];
  hasMajor: boolean;
  hasMinor: boolean;
  banner: string | null;
  price: PriceView;
  checklist: string[];
  limitation: string;
}

// ------------------------------------------------------- marker + proximity

/** Từ chỉ "ở GẦN", không chỉ "LÀ" — chặn chúng biến chỗ lân cận thành chỗ của tin. */
const PROXIMITY_WORDS = ["gan", "canh", "doi dien", "ke", "sat", "gan ben"] as const;

// B-1: marker dự án chia 2 mức hẹp/rộng. Marker rộng ("căn hộ"/"chung cư")
// xuất hiện trong hầu hết tin căn hộ nên yêu cầu >= 2 token tên; marker hẹp
// ("dự án"/"khu đô thị") là ngữ cảnh dự án tường minh hơn, 1 token distinctive
// vẫn nhận ("Dự án Ecopark").
const PROJECT_MARKERS_STRICT = ["khu do thi", "du an"] as const;
const PROJECT_MARKERS_BROAD = ["chung cu", "can ho"] as const;
const TOWER_MARKERS = ["toa nha", "toa", "block", "thap"] as const;
const LOCATION_MARKERS = [
  "khu pho",
  "thi tran",
  "duong",
  "pho",
  "phuong",
  "quan",
  "huyen",
  "xa",
] as const;

/**
 * B-1: token mô tả chung — tên dự án KHÔNG được ghép hoàn toàn từ các token
 * này. "Căn Hộ Cao Cấp", "Dự án Đẹp Giá Rẻ", "Chung cư Nội Thất Mới" đều bị
 * loại. Thà bỏ sót tên dự án thật (false negative) hơn là nhận cụm mô tả
 * làm tên dự án rồi sinh ra bằng chứng hoặc mâu thuẫn giả.
 *
 * B-1 residual: mở rộng lexicon cho các cụm Title Case mô tả bất động sản
 * phổ biến ("View Đẹp", "Full Nội Thất", "Mới Bàn Giao", "Góc Hai Mặt Tiền",
 * "Siêu Phẩm Đầu Tư", "Hướng Đông Nam"…). Chỉ dùng cho VALIDATE tên dự án —
 * không dâng sang GENERIC_TOKENS của M6 (đóng băng theo B-2).
 */
const PROJECT_GENERIC = new Set([
  // chất lượng / hình thức
  "cao", "cap", "dep", "moi", "gia", "re", "noi", "that", "xin", "sang",
  "trong", "tang", "trung", "thap",
  // từ loại nhà / marker
  "can", "ho", "chung", "cu", "nha", "dat",
  // marketing / tiện ích / mô tả vị trí phổ biến (B-1 residual)
  "view", "full", "ban", "giao", "tot", "goc", "hai", "mat", "tien",
  "sieu", "pham", "dau", "tu", "huong", "dong", "tay", "nam", "bac",
  "rong", "thoang",
  // từ chốt giao dịch / quảng cáo (B-1 final patch: "Chính Chủ",
  // "Sổ Hồng Riêng", "Liên Hệ Ngay" từng vượt guard vì token >= 5 ký tự)
  "chinh", "chu", "so", "hong", "rieng", "lien", "he", "ngay",
]);

function markerRegex(words: readonly string[]): RegExp {
  const alt = words.map((w) => w.replace(/ /g, "\\s+")).join("|");
  return new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, "g");
}

// ------------------------------------------------------- token gốc + capture

interface OriginalToken {
  text: string;
  start: number;
  end: number;
}

function originalTokens(original: string): OriginalToken[] {
  const out: OriginalToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

interface CapturedName {
  name: string;
  start: number;
  end: number;
  tokenCount: number;
}

/**
 * Bắt chuỗi token đứng ngay sau marker, trên văn bản GỐC (giữ dấu + hoa/thường).
 * Dừng ở token đầu tiên không đạt `accept` — bảo thủ, không đoán tiếp.
 */
function captureAfterMarker(
  original: string,
  listing: NormalizedListing,
  markerEndNorm: number,
  accept: (tok: string) => boolean,
  maxTokens: number,
): CapturedName | null {
  const origFrom = listing.endMap[Math.min(markerEndNorm - 1, listing.endMap.length - 1)];
  const parts: string[] = [];
  let firstStart = -1;
  let lastEnd = -1;
  for (const t of originalTokens(original)) {
    if (parts.length >= maxTokens) break;
    if (t.start < origFrom) continue;
    const stripped = t.text
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[^\p{L}\p{N}]+$/u, "");
    if (!stripped || !accept(stripped)) break;
    const lead = t.text.length - t.text.replace(/^[^\p{L}\p{N}]+/u, "").length;
    const cs = t.start + lead;
    const ce = cs + stripped.length;
    if (firstStart === -1) firstStart = cs;
    lastEnd = ce;
    parts.push(stripped);
    // Tên riêng không vượt qua ranh giới câu / dấu ngăn danh sách:
    // "Vinhomes Grand Park. Vinhomes ..." phải dừng ở "Park".
    if (/[.,;:!?]$/.test(t.text)) break;
  }
  if (parts.length === 0) return null;
  return { name: original.slice(firstStart, lastEnd), start: firstStart, end: lastEnd, tokenCount: parts.length };
}

/** Token tên riêng: viết hoa chữ đầu, >= 2 ký tự, không thuần số. */
function isNameTok(s: string): boolean {
  return s.length >= 2 && !/^\d+$/.test(s) && /^\p{Lu}/u.test(s);
}

/** Token mã tòa/block: có cả chữ và số, ngắn; hoặc MỘT chữ viết hoa. */
function isTowerTok(s: string): boolean {
  if (/[0-9]/.test(s) && /[a-z]/i.test(s) && s.length <= 6) return true;
  return s.length === 1 && /^\p{Lu}$/u.test(s);
}

interface ExtractedName {
  name: string;
  /** Dạng chuẩn để so sánh + để LOẠI khỏi phần so sánh câu chữ. */
  normKey: string;
}

function normKeyOf(name: string): string {
  return normalizeListing(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Tìm tên đứng sau marker ĐẦU TIÊN hợp lệ.
 * Marker phải là ngữ cảnh tường minh ("dự án X", "căn hộ X", "tòa S1",
 * "đường Nguyễn Văn Linh") — không phải mọi chữ hoa trong tin.
 * "gần/cạnh/đối diện/kế/sát" trước marker chặn trích xuất: đó là chỗ LÂN CẬN.
 * `validate` cho phép từ chọc ứng viên (ví dụ: tên toàn token generic) và
 * quét TIẾP marker kế tiếp thay vì bỏ cả tin.
 */
function findMarkedName(
  original: string,
  listing: NormalizedListing,
  markers: readonly string[],
  accept: (tok: string) => boolean,
  minTokens: number,
  maxTokens: number,
  extraGuard?: (at: number, len: number) => boolean,
  validate?: (cap: CapturedName) => boolean,
): ExtractedName | null {
  const norm = listing.normalized;
  const re = markerRegex(markers);
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const at = m.index;
    const endNorm = at + m[0].length;
    if (precededByAny(norm, at, PROXIMITY_WORDS)) continue;
    if (extraGuard && !extraGuard(at, m[0].length)) continue;
    const cap = captureAfterMarker(original, listing, endNorm, accept, maxTokens);
    if (cap && cap.tokenCount >= minTokens && (!validate || validate(cap))) {
      return { name: cap.name, normKey: normKeyOf(cap.name) };
    }
  }
  return null;
}

/** B-1: tên dự án toàn token generic ("Cao Cấp") -> từ chối. */
function isGenericProjectName(cap: CapturedName): boolean {
  const tokens = normKeyOf(cap.name)
    .split(" ")
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  if (tokens.length === 0) return true;
  return tokens.every((t) => PROJECT_GENERIC.has(t));
}

/**
 * B-1 residual (marker rộng): với "căn hộ"/"chung cư", một cụm tên phải có
 * ít nhất MỘT token thực sự nhận diện được — không generic, không thuần số,
 * và >= 5 ký tự chuẩn hoá.
 * "Vinhomes Grand Park" có "vinhomes"; "The Beverly" có "beverly".
 * "View Đẹp", "Mới Bàn Giao", "Hướng Đông Nam", "View Sông" không token nào
 * đạt -> loại. Chấp nhận false negative (tên thật ngắn sau marker rộng).
 */
function hasDistinctiveProjectToken(cap: CapturedName): boolean {
  return normKeyOf(cap.name)
    .split(" ")
    .some((t) => t.length >= 5 && !/^\d+$/.test(t) && !PROJECT_GENERIC.has(t));
}

/**
 * Dự án: marker hẹp trước ("dự án"/"khu đô thị", 1 token distinctive được
 * nhận), rồi mới tới marker rộng ("căn hộ"/"chung cư", >= 2 token tên).
 * Cả hai mức đều loại tên toàn token generic.
 */
function findProject(original: string, listing: NormalizedListing): ExtractedName | null {
  const notGeneric = (cap: CapturedName) => !isGenericProjectName(cap);
  const strict = findMarkedName(
    original,
    listing,
    PROJECT_MARKERS_STRICT,
    isNameTok,
    1,
    6,
    undefined,
    notGeneric,
  );
  if (strict) return strict;
  // Marker rộng thêm một tầng nhận diện (B-1 residual): cụm toàn mô tả
  // Title Case ("View Đẹp", "Góc Hai Mặt Tiền") không có token >= 5 ký tự
  // ngoài lexicon generic -> không phải tên dự án.
  const broadOk = (cap: CapturedName) =>
    !isGenericProjectName(cap) && hasDistinctiveProjectToken(cap);
  return findMarkedName(original, listing, PROJECT_MARKERS_BROAD, isNameTok, 2, 6, undefined, broadOk);
}

/**
 * "xa" không dấu là tính từ (xa trung tâm), không phải "xã".
 * Chỉ nhận marker này khi bản GỐC có dấu.
 */
function makeXaGuard(original: string, listing: NormalizedListing): (at: number, len: number) => boolean {
  return (at, len) => {
    if (len !== 2) return true;
    const orig = original.slice(listing.map[at], listing.endMap[at + 1]).toLowerCase();
    return orig !== "xa";
  };
}

// ------------------------------------------------------- so sánh câu chữ (M6)

/** Cụm bị coi là quảng cáo/câu chốt chung — loại khỏi bằng chứng mô tả. */
const GENERIC_BLOCK_PHRASES = [
  "so hong rieng",
  "gia tot",
  "lien he ngay",
  "lien he",
  "chinh chu",
  "vi tri dep",
  "day du tien ich",
  "dau tu sinh loi",
  "sieu pham",
  "can ban",
] as const;

/** Token không mang nghĩa riêng — nếu CẢ cụm chỉ gồm các token này thì loại. */
const GENERIC_TOKENS = new Set([
  "so", "hong", "rieng", "gia", "tot", "lien", "he", "ngay", "chinh", "chu",
  "vi", "tri", "dep", "day", "du", "tien", "ich", "dau", "tu", "sinh", "loi",
  "sieu", "pham", "can", "ban", "hot", "co", "hoi", "vang", "cam", "ket",
  "uu", "dai", "moi", "nha", "dat",
]);

/** Token có nghĩa: >= 2 ký tự và không thuần số. */
function isMeaningful(t: string): boolean {
  return t.length >= 2 && !/^\d+$/.test(t);
}

// B-3: bảo vệ hiệu năng. Mỗi tin tối đa 1000 ký tự, nhưng cụm lặp/token rác có
// thể tạo khối lượng so khớp lũy tiến (đã đo ~191ms median cho input đối kháng).
// Chặn bằng 3 trần tất định — thà bỏ sót cụm mô tả (false negative) hơn là
// khiến người dùng chờ.
const MAX_OVERLAP_TOKENS = 150;
const MAX_OVERLAP_CANDIDATES = 200;
const MAX_OVERLAP_WORK = 40_000;
/** Cụm mà >=70% token có nghĩa là từ quảng cáo chung thì không "đặc trưng". */
const GENERIC_RATIO_MAX = 0.7;

/** Ranh giới cứng: vùng đã che ("~") và dấu kết thúc câu. Dấu phẩy là mềm. */
const BOUNDARY_CHARS = /[~.!?:;]/;

/**
 * Token tên-trường (marker) — KHÔNG dùng làm token đặc trưng loại M6:
 * không chặn cụm mô tả chỉ vì chứa "căn", "hộ", "đường", "quận"…
 */
const FIELD_MARKER_TOKENS = new Set([
  "can", "ho", "du", "an", "duong", "pho", "phuong", "quan", "huyen", "xa",
  "khu", "thi", "tran", "toa", "block", "thap",
]);

/**
 * Token đặc trưng của dự án/cụm vị trí ĐÃ được tính bằng chứng (B-2):
 * M6 không được đếm lại các token này. Marker bị loại khỏi tập để không
 * chặn nhầm cụm mô tả không liên quan.
 */
function distinctiveTokensOf(...names: Array<ExtractedName | null>): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    for (const t of n.normKey.split(" ")) {
      if (t.length >= 2 && !FIELD_MARKER_TOKENS.has(t)) out.add(t);
    }
  }
  return [...out];
}

function maskRegion(s: string, start: number, end: number): string {
  return s.slice(0, start) + "~".repeat(end - start) + s.slice(end);
}

/** Che token theo ranh giới từ bằng chuỗi "~" CÙNG ĐỘ DÀI — bảng ánh xạ vẫn đúng. */
function stripWordTokens(s: string, tokens: readonly string[]): string {
  let out = s;
  for (const t of tokens) {
    out = out.replace(new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`, "g"), (m) => "~".repeat(m.length));
  }
  return out;
}

/**
 * Che điện thoại/URL bằng ranh giới CỨNG, không phải khoảng trắng (§18):
 * hai cụm mô tả hai bên số điện thoại KHÔNG được nối thành một cụm nhân tạo
 * xuyên qua vùng đã che. "~" không phải ký tự từ nên token hai bên vẫn tách,
 * và dấu "~" trong khoảng trống trở thành ranh giới cứng khi so khớp.
 * Mọi thay thế đều CÙNG ĐỘ DÀI để bảng ánh xạ chỉ số gốc vẫn trỏ đúng.
 */
function stripNonEvidence(norm: string): string {
  let out = norm.replace(/https?:\/\/\S+/g, (m) => "~".repeat(m.length));
  out = out.replace(/(^|[^a-z0-9])www\.[^\s]+/g, (m) => "~".repeat(m.length));
  out = out.replace(/(?:\+?\s*84|0)[\d\s.\-()]{5,16}\d/g, (m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 8 ? "~".repeat(m.length) : m;
  });
  return out;
}

interface TokBoundary {
  toks: ReturnType<typeof tokenize>;
  boundaryBefore: boolean[];
}

/**
 * Tách token kèm cờ "có ranh giới cứng đứng trước token này": khoảng trống
 * giữa hai token chứa "~" (điện thoại/URL/giá/tên trường đã che) hoặc dấu kết
 * thúc câu . ! ? ; : (§19). Dấu phẩy KHÔNG phải ranh giới.
 */
function tokensWithBoundaries(norm: string): TokBoundary {
  const toks = tokenize(norm);
  const boundaryBefore = toks.map((_, j) => {
    if (j === 0) return true;
    const gap = norm.slice(toks[j - 1].end, toks[j].start);
    return BOUNDARY_CHARS.test(gap);
  });
  return { toks, boundaryBefore };
}

/**
 * Cụm mô tả chung đủ đặc trưng (M6), tối đa 2 đơn vị.
 *
 * Thuật toán có GIỚI HẠN (B-3): với MỖI vị trí bắt đầu trong tin B, chỉ tìm
 * khớp DÀI NHẤT trên tin A qua bảng vị trí token, trong ngân sách bước so
 * sánh cố định. Không liệt kê mọi substring — không n^2 key, không n^3 char.
 *
 * Trước khi so khớp, vùng điện thoại/URL/giá và token đặc trưng của dự án/
 * cụm vị trí đã tính bị CHE bằng ranh giới cứng nên: cụm không bao giờ đếm
 * lại trường đã tính (B-2), và không xuyên qua điện thoại/URL/kết thúc câu
 * (§18/§19). Không fuzzy, không Levenshtein, không AI.
 */
function computeCommonSpans(
  originalB: string,
  listingA: NormalizedListing,
  listingB: NormalizedListing,
  distinctive: readonly string[],
  priceSpansA: readonly PriceSpan[],
  priceSpansB: readonly PriceSpan[],
): string[] {
  let normA = stripNonEvidence(listingA.normalized);
  let normB = stripNonEvidence(listingB.normalized);
  for (const sp of priceSpansA) normA = maskRegion(normA, sp.start, sp.end);
  for (const sp of priceSpansB) normB = maskRegion(normB, sp.start, sp.end);
  normA = stripWordTokens(normA, distinctive);
  normB = stripWordTokens(normB, distinctive);

  const pa = tokensWithBoundaries(normA);
  const pb = tokensWithBoundaries(normB);
  // B-3: chỉ so khớp trên tối đa 150 token đầu mỗi tin. Trích xuất trường và
  // parse giá KHÔNG bị cắt — chỉ phần cụm mô tả là có giới hạn an toàn.
  const toksA = pa.toks.slice(0, MAX_OVERLAP_TOKENS);
  const toksB = pb.toks.slice(0, MAX_OVERLAP_TOKENS);
  if (toksA.length < 5 || toksB.length < 5) return [];

  // Bảng vị trí token trong A — thay cho việc dựng mọi n-gram.
  const occurA = new Map<string, number[]>();
  toksA.forEach((t, idx) => {
    const arr = occurA.get(t.text);
    if (arr) arr.push(idx);
    else occurA.set(t.text, [idx]);
  });

  // Mỗi vị trí bắt đầu: một ứng viên (khớp dài nhất), có ngân sách công.
  const cand: Array<{ i: number; len: number }> = [];
  let work = 0;
  let budgetDone = false;
  for (let i = 0; i < toksB.length && !budgetDone; i++) {
    if (cand.length >= MAX_OVERLAP_CANDIDATES) break;
    const occs = occurA.get(toksB[i].text);
    if (!occs) continue;
    let bestLen = 0;
    for (const p of occs) {
      let len = 1;
      while (
        i + len < toksB.length &&
        p + len < toksA.length &&
        !pb.boundaryBefore[i + len] &&
        !pa.boundaryBefore[p + len] &&
        toksB[i + len].text === toksA[p + len].text
      ) {
        len++;
        work++;
        if (work > MAX_OVERLAP_WORK) {
          budgetDone = true;
          break;
        }
      }
      if (budgetDone) break;
      if (len > bestLen) bestLen = len;
    }
    if (bestLen >= 5) cand.push({ i, len: bestLen });
  }

  const quotes: string[] = [];
  const acceptedKeys: string[] = [];
  const used: Array<[number, number]> = [];
  // Dài nhất trước, rồi vị trí sớm nhất — thứ tự tất định.
  const byLen = [...cand].sort((x, y) => y.len - x.len || x.i - y.i);
  for (const c of byLen) {
    if (quotes.length >= 2) break;
    if (used.some(([s, e]) => c.i < e && s < c.i + c.len)) continue;
    const toks = toksB.slice(c.i, c.i + c.len).map((t) => t.text);
    const key = toks.join(" ");
    const wrappedKey = ` ${key} `;
    // Gộp cả PHẦN CHỨA: cụm lặp lại ở chỗ khác, dù là đoạn con của cụm đã
    // nhận, vẫn là CÙNG nội dung — chỉ đếm một lần.
    if (
      acceptedKeys.some((k) => wrappedKey.includes(` ${k} `) || ` ${k} `.includes(wrappedKey))
    ) {
      continue;
    }
    const meaningful = toks.filter(isMeaningful);
    if (meaningful.length < 5) continue;
    if (key.length < 24) continue;
    if (GENERIC_BLOCK_PHRASES.some((p) => key.includes(p))) continue;
    if (toks.every((t) => GENERIC_TOKENS.has(t))) continue;
    const genericCount = meaningful.filter((t) => GENERIC_TOKENS.has(t)).length;
    if (meaningful.length > 0 && genericCount / meaningful.length >= GENERIC_RATIO_MAX) {
      continue;
    }
    used.push([c.i, c.i + c.len]);
    acceptedKeys.push(key);
    // Trích dẫn từ văn bản GỐC của tin B — mọi thay thế đều cùng độ dài nên
    // bảng ánh xạ chỉ số gốc vẫn trỏ đúng (giữ dấu, hoa/thường, dấu câu).
    const startNorm = toksB[c.i].start;
    const endNorm = toksB[c.i + c.len - 1].end;
    quotes.push(
      originalB
        .slice(listingB.map[startNorm], listingB.endMap[endNorm - 1])
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return quotes;
}

// ------------------------------------------------------------- phần giá

function buildPriceView(pa: PriceParse, pb: PriceParse): PriceView {
  if (pa.kind === "total" && pb.kind === "total") {
    if (pa.valueVnd === pb.valueVnd) {
      return {
        status: "equal",
        lines: [priceLine("A", pa.quote), priceLine("B", pb.quote), PRICE_EQUAL_TEXT],
      };
    }
    const abs = Math.abs(pa.valueVnd - pb.valueVnd);
    return {
      status: "compared",
      lines: [
        priceLine("A", pa.quote),
        priceLine("B", pb.quote),
        priceDiffLine(formatVndShort(abs)),
        pricePctLine(pctText(pa.valueVnd, pb.valueVnd)),
      ],
    };
  }
  return { status: "unavailable", lines: [PRICE_UNAVAILABLE_NOTE] };
}

// ------------------------------------------------------------- hàm chính

export interface DuplicateCheckInput {
  textA: string;
  textB: string;
}

/**
 * So sánh câu chữ hai tin. Trả null khi một trong hai tin quá ngắn.
 */
export function compareDuplicate(input: DuplicateCheckInput): DuplicateCheckResult | null {
  const textA = typeof input?.textA === "string" ? input.textA : "";
  const textB = typeof input?.textB === "string" ? input.textB : "";
  const a = textA.trim();
  const b = textB.trim();
  if (a.length < MIN_TEXT_LENGTH || b.length < MIN_TEXT_LENGTH) return null;

  const listingA = normalizeWithMap(a);
  const listingB = normalizeWithMap(b);

  const shared: SharedUnit[] = [];
  const majors: Contradiction[] = [];
  const minors: Contradiction[] = [];

  // Tỉnh/thành — ngữ cảnh thô. Khác tỉnh tường minh là mâu thuẫn lớn.
  const provinceA = detectProvince(a);
  const provinceB = detectProvince(b);
  if (provinceA && provinceB && provinceA !== provinceB) {
    majors.push({ severity: "major", text: provinceDiff(provinceA, provinceB) });
  }

  // Dự án — M1 (giống) hoặc mâu thuẫn lớn (khác hẳn, cả hai đều trích được
  // chắc chắn qua marker tường minh VÀ qua kiểm tra không-generic).
  const projectA = findProject(a, listingA);
  const projectB = findProject(b, listingB);
  let hasProjectShared = false;
  if (projectA && projectB) {
    if (projectA.normKey === projectB.normKey) {
      shared.push({ kind: "project", text: projectLabel(projectA.name) });
      hasProjectShared = true;
    } else {
      majors.push({ severity: "major", text: projectDiff(projectA.name, projectB.name) });
    }
  }

  // Tòa/block — chỉ là mâu thuẫn khi CẢ HAI đều trích được sau marker tường minh.
  const towerA = findMarkedName(a, listingA, TOWER_MARKERS, isTowerTok, 1, 2);
  const towerB = findMarkedName(b, listingB, TOWER_MARKERS, isTowerTok, 1, 2);
  if (towerA && towerB && towerA.normKey !== towerB.normKey) {
    majors.push({ severity: "major", text: towerDiff(towerA.name, towerB.name) });
  }

  // Diện tích — dùng lib/area.ts nguyên trạng: dải -> null (trung tính).
  const areaA = extractAreaM2(a);
  const areaB = extractAreaM2(b);
  if (areaA != null && areaB != null) {
    if (Math.abs(areaA - areaB) <= 0.5) {
      shared.push({ kind: "area", text: areaLabel(areaA, areaB) });
    } else if (Math.max(areaA, areaB) / Math.min(areaA, areaB) > 1.2) {
      majors.push({ severity: "major", text: areaDiff(areaA, areaB) });
    }
    // Lệch nhỏ hơn 20% nhưng > 0.5 m²: trung tính — không bằng chứng, không mâu thuẫn.
  }

  // Phòng ngủ — giống là MEDIUM, khác là mâu thuẫn nhỏ.
  const bedA = extractBedrooms(a);
  const bedB = extractBedrooms(b);
  if (bedA != null && bedB != null) {
    if (bedA === bedB) shared.push({ kind: "bedrooms", text: bedroomsLabel(bedA) });
    else minors.push({ severity: "minor", text: bedroomsDiff(bedA, bedB) });
  }

  // Cụm vị trí tự do (đường/phường/quận/phố...) — chỉ là BẰNG CHỮ, không phải địa chỉ đã kiểm chứng.
  const locA = findMarkedName(
    a,
    listingA,
    LOCATION_MARKERS,
    isNameTok,
    2,
    5,
    makeXaGuard(a, listingA),
  );
  const locB = findMarkedName(
    b,
    listingB,
    LOCATION_MARKERS,
    isNameTok,
    2,
    5,
    makeXaGuard(b, listingB),
  );
  let hasLocationShared = false;
  if (locA && locB && locA.normKey === locB.normKey) {
    shared.push({ kind: "location_phrase", text: locationLabel(locA.name) });
    hasLocationShared = true;
  }
  // Khác cụm vị trí: trung tính — tên đường trùng chữ không khẳng định trùng nơi.

  // Giá — KHÔNG BAO GIỜ là bằng chứng giống nhau, và KHÔNG phải mâu thuẫn.
  const priceA = analyzePrices(a, listingA);
  const priceB = analyzePrices(b, listingB);
  const price = buildPriceView(priceA.parse, priceB.parse);

  // Cụm mô tả trùng — M6, tối đa 2 đơn vị. Token đặc trưng của dự án/cụm
  // vị trí đã tính và vùng giá bị CHE trước khi so khớp, nên M6 không thể
  // đếm lại trường đã tính (B-2) hay xuyên qua điện thoại/URL (§18).
  const distinctive = distinctiveTokensOf(projectA, projectB, locA, locB);
  for (const quote of computeCommonSpans(
    b,
    listingA,
    listingB,
    distinctive,
    priceA.spans,
    priceB.spans,
  )) {
    shared.push({ kind: "text_span", text: spanLabel(quote) });
  }

  const count = shared.length;
  const hasMajor = majors.length > 0;
  const hasMinor = minors.length > 0;

  // HIGH chỉ bằng tổng hợp; mâu thuẫn lớn ép LOW; mâu thuẫn nhỏ chặn HIGH.
  let level: DuplicateLevel;
  if (hasMajor) {
    level = "low";
  } else if (count >= 3 && (hasProjectShared || hasLocationShared) && !hasMinor) {
    level = "high";
  } else if (count >= 2) {
    level = "medium";
  } else {
    level = "low";
  }

  const contradictions = [...majors, ...minors];

  return {
    level,
    levelLabel: LEVEL_LABEL[level],
    explanation: LEVEL_EXPLANATION[level],
    count,
    shared,
    contradictions,
    hasMajor,
    hasMinor,
    banner: contradictions.length > 0 ? BANNER_TEXT : null,
    price,
    checklist: [...CHECKLIST],
    limitation: LIMITATION,
  };
}
