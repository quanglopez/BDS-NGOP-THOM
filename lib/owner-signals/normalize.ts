// Owner/Broker signal tool (PHASE 4) — bỏ dấu + chuẩn hoá + ngữ cảnh cục bộ.
//
// Người đăng tin thường viết rất khác nhau cho cùng một ý:
//   "chính chủ" / "chinh chu" / "Chính Chủ" / "chínhchủ"
// nên không thể so khớp thẳng trên chuỗi gốc.
//
// Cách làm bám theo tiền lệ đã có trong repo (lib/provinces.ts `norm()`,
// lib/report/slug.ts, lib/geo/url-parser.ts): NFD + bỏ dấu + lowercase.
//
// ĐIỂM QUAN TRỌNG — TRÍCH DẪN PHẢI LÀ CÂU CHỮ THẬT CỦA NGƯỜI ĐĂNG:
// Bản chuẩn hoá KHÔNG bảo đảm cùng độ dài với bản gốc. Lý do:
//   - "í" (precomposed, 1 ký tự) -> NFD thành "i" + U+0301 -> bỏ dấu -> "i"  (giữ nguyên)
//   - nhưng nếu văn bản dán vào ĐÃ ở dạng tách rời ("i" + U+0301 sẵn) thì
//     bỏ dấu sẽ làm NGẮN đi 1 ký tự.
// Vì vậy không được lấy index trên bản chuẩn hoá rồi cắt thẳng bản gốc.
// `normalizeWithMap()` dựng kèm bảng ánh xạ chỉ số -> chỉ số gốc, nên câu
// trích dẫn luôn cắt đúng trên văn bản người dùng đã dán, kể cả ở dạng tách rời.
//
// PHẦN NGỮ CẢNH (negation / exclusion):
// Khớp được một cụm KHÔNG có nghĩa là cụm đó đang được dùng để nói điều ta
// tưởng. "Tôi không nhận ký gửi" chứa nguyên "nhận ký gửi" nhưng nghĩa ngược
// lại. Nên trước khi nhận một khớp, phải soi ngữ cảnh NGAY TRƯỚC nó, trong
// phạm vi MỘT MỆNH ĐỀ (không nhảy qua dấu câu / liên từ).

/** Bỏ dấu tiếng Việt, lowercase. Dùng để so khớp, KHÔNG dùng để cắt trích dẫn. */
export function normalizeListing(input: string): string {
  return input
    .normalize("NFD")
    // Chỉ xoá dấu thanh/dấu phụ tổ hợp (\p{M}) — không xoá ký tự gốc.
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

export interface NormalizedListing {
  /** Chuỗi đã bỏ dấu, dùng để tìm vị trí khớp. */
  normalized: string;
  /** map[i] = chỉ số trong CHUỖI GỐC của ký tự normalized[i]. */
  map: number[];
  /**
   * endMap[i] = chỉ số KẾT THÚC (exclusive) trong chuỗi gốc cho ký tự
   * normalized[i], đã tính cả các dấu tổ hợp đi ngay sau nó.
   *
   * Cần riêng endMap vì dấu tổ hợp không sinh ra ký tự nào trong bản chuẩn
   * hoá. Với văn bản ở dạng tách rời ("u" + U+0309), nếu chỉ dùng map thì
   * trích dẫn sẽ cắt thiếu dấu ở ký tự cuối.
   */
  endMap: number[];
  /** Danh sách token [a-z0-9]+ — dùng cho việc soi ngữ cảnh theo từ. */
  tokens: Token[];
}

/**
 * Chuẩn hoá kèm bảng ánh xạ chỉ số.
 *
 * Với mỗi ký tự của chuỗi gốc, ta chuẩn hoá RIÊNG nó rồi ghi lại chỉ số gốc
 * cho từng ký tự đầu ra. Nhờ vậy ánh xạ luôn đúng dù ký tự đó co lại (bỏ dấu
 * thanh) hay giãn ra, và không phụ thuộc việc văn bản vào ở dạng precomposed
 * hay decomposed.
 *
 * Dấu tổ hợp (không sinh ký tự đầu ra) được "dán" vào ký tự đứng trước nó,
 * để `endMap` bao trọn cụm ký tự khi trích dẫn.
 */
export function normalizeWithMap(input: string): NormalizedListing {
  let normalized = "";
  const map: number[] = [];
  const endMap: number[] = [];

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const piece = normalizeListing(ch);

    if (piece.length === 0) {
      // Dấu tổ hợp rời: không sinh ký tự mới, nhưng thuộc về ký tự trước đó.
      if (endMap.length > 0) endMap[endMap.length - 1] = i + 1;
      continue;
    }

    for (let k = 0; k < piece.length; k++) {
      normalized += piece[k];
      map.push(i);
      endMap.push(i + 1);
    }
  }

  return { normalized, map, endMap, tokens: tokenize(normalized) };
}

/** Tách token [a-z0-9]+ kèm vị trí, để soi ngữ cảnh theo TỪ thay vì theo ký tự. */
export function tokenize(normalized: string): Token[] {
  const out: Token[] = [];
  const re = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Chuẩn hoá thêm cho việc so khớp "chắc chắn trúng": gộp mọi ký tự không phải
 * chữ/số thành 1 khoảng trắng. Dùng khi cần đối chiếu cụm có thể bị ngắt bởi
 * dấu câu ("chính chủ, không tiếp môi giới").
 *
 * KHÔNG dùng bản này để lấy index — nó đổi độ dài.
 */
export function squeezeWhitespace(normalized: string): string {
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

// ------------------------------------------------------------- clause context

/**
 * Dấu câu kết thúc/ngăn mệnh đề. Phủ định KHÔNG được nhảy qua mấy ký tự này:
 * "Không cần sửa chữa. Nhận ký gửi nhà phố" — "không" thuộc mệnh đề trước,
 * không phủ định "nhận ký gửi".
 */
const CLAUSE_BOUNDARY_CHARS = /[.,;:!?()"“”\n\r]/;

/**
 * Liên từ nối mệnh đề. Cũng là ranh giới: phủ định đứng trước liên từ thì
 * thuộc về vế trước, không áp cho vế sau.
 */
const CLAUSE_BOUNDARY_WORDS = new Set([
  "va",
  "nhung",
  "tuy",
  "nhien",
  "song",
  "ngoai",
  "ra",
  "hoac",
  "hay",
  "roi",
]);

/** Giữa `from` và `to` có ranh giới mệnh đề không? */
export function hasClauseBoundary(normalized: string, from: number, to: number): boolean {
  if (to <= from) return false;
  const between = normalized.slice(from, to);
  if (CLAUSE_BOUNDARY_CHARS.test(between)) return true;

  for (const t of tokenize(between)) {
    if (CLAUSE_BOUNDARY_WORDS.has(t.text)) return true;
  }
  return false;
}

/**
 * Từ phủ định, ở dạng ĐÃ CHUẨN HOÁ vì so khớp chạy trên bản chuẩn hoá —
 * trộn literal có dấu với không dấu là lỗi đã gặp.
 */
const NEGATION_MARKERS = new Set(["khong", "chang", "chua", "khoi", "ko", "k"]);

/**
 * "chữa" (sửa chữa) và "chưa" (chưa làm gì) bỏ dấu đều thành "chua".
 * Đây là cặp từ khác nghĩa hoàn toàn, nên phải phân biệt bằng chữ GỐC có dấu:
 * chỉ "chưa" mới là phủ định.
 */
const NEGATION_FALSE_FRIENDS: Record<string, readonly string[]> = {
  chua: ["chữa"],
};

/**
 * "miễn" KHÔNG phải lúc nào cũng là phủ định: "miễn phí xem nhà" là một dịch vụ,
 * còn "miễn trung gian" mới là loại trừ. Chỉ coi là phủ định khi từ ngay sau
 * thuộc nhóm loại trừ dưới đây.
 */
const MIEN_EXCLUSION_FOLLOWERS = new Set(["trung", "moi", "qua", "tiep"]);

/** Số token tối đa nhìn ngược lại. Xa hơn thì coi như khác mệnh đề. */
const NEGATION_WINDOW_TOKENS = 3;

/** Cắt đoạn VĂN BẢN GỐC (còn dấu) ứng với một token. */
function tokenOriginal(original: string, listing: NormalizedListing, token: Token): string {
  const start = listing.map[token.start];
  const end = listing.endMap[token.end - 1];
  return original.slice(start, end).toLowerCase();
}

/**
 * Token này có phải từ phủ định không?
 * Kiểm tra thêm chữ gốc để loại cặp từ đồng âm sau khi bỏ dấu ("chữa" ≠ "chưa").
 */
function isNegationToken(
  original: string,
  listing: NormalizedListing,
  token: Token,
): boolean {
  if (!NEGATION_MARKERS.has(token.text)) return false;
  const falseFriends = NEGATION_FALSE_FRIENDS[token.text];
  if (falseFriends) {
    const raw = tokenOriginal(original, listing, token);
    if (falseFriends.includes(raw)) return false;
  }
  return true;
}

/**
 * Cụm khớp bắt đầu tại `at` có đang bị phủ định bởi ngữ cảnh ngay trước không?
 *
 * Quy tắc:
 * - chỉ nhìn ngược tối đa NEGATION_WINDOW_TOKENS token;
 * - dừng ngay khi gặp ranh giới mệnh đề (dấu câu / liên từ);
 * - gặp từ phủ định trong phạm vi đó -> coi như bị phủ định.
 *
 * Nhờ vậy "không cần sửa chữa. Nhận ký gửi nhà phố" vẫn nhận ra "nhận ký gửi":
 * dấu chấm chặn phủ định của mệnh đề trước.
 */
export function isNegated(
  original: string,
  listing: NormalizedListing,
  at: number,
): boolean {
  const { tokens } = listing;

  let matchIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start >= at) {
      matchIdx = i;
      break;
    }
  }
  if (matchIdx === -1) return false;

  for (let d = 1; d <= NEGATION_WINDOW_TOKENS; d++) {
    const i = matchIdx - d;
    if (i < 0) return false;

    const tok = tokens[i];
    // Ranh giới mệnh đề giữa token này và cụm khớp -> phủ định không với tới.
    if (hasClauseBoundary(listing.normalized, tok.end, tokens[matchIdx].start)) {
      return false;
    }

    if (isNegationToken(original, listing, tok)) return true;

    if (tok.text === "mien") {
      const next = tokens[i + 1];
      if (next && MIEN_EXCLUSION_FOLLOWERS.has(next.text)) return true;
    }
  }

  return false;
}

/**
 * Cụm khớp bắt đầu tại `at` có bị chặn bởi ngữ cảnh đứng ngay trước không?
 *
 * `phrases` là các cụm ĐÃ CHUẨN HOÁ, ví dụ "chung toi", "cong ty". So khớp theo
 * ranh giới từ (không phải substring) nên "bên" không khớp nhầm vào "bên cạnh".
 *
 * Cần nhiều token vì tiếng Việt có cụm lồng nhau thật: "Công ty tôi cần bán"
 * chứa "tôi cần bán" nhưng từ ngay trước là "ty", không phải "công".
 */
export function precededByAny(
  normalized: string,
  at: number,
  phrases: readonly string[],
): boolean {
  // Bỏ khoảng trắng/dấu câu ngay trước cụm khớp để so được với cụm nhiều token:
  // "Công ty tôi cần bán" -> phần trước là "cong ty " (có dấu cách cuối).
  const before = normalized.slice(0, at).replace(/[^a-z0-9]+$/, "");

  for (const phrase of phrases) {
    if (!before.endsWith(phrase)) continue;
    const idx = before.length - phrase.length;
    if (idx === 0) return true;
    // Ký tự ngay trước cụm phải là ranh giới từ, tránh khớp giữa từ.
    if (!/[a-z0-9]/.test(before[idx - 1])) return true;
  }

  return false;
}

// ------------------------------------------------------------------- matching

export interface PhraseMatch {
  /** Cụm gốc, cắt ra từ CHÍNH văn bản người dùng dán (giữ nguyên dấu). */
  quote: string;
  /** Vị trí bắt đầu trong văn bản gốc. */
  index: number;
  /** Vị trí kết thúc (exclusive) trong văn bản gốc — dùng để phát hiện chồng lấn. */
  end: number;
}

export interface FindPhraseOptions {
  /**
   * Nếu cụm khớp bị một trong các cụm này đứng ngay trước thì BỎ QUA khớp đó
   * (thử tìm vị trí khớp kế tiếp). Cụm phải ở dạng đã chuẩn hoá.
   */
  excludeIfPrecededBy?: readonly string[];
  /**
   * Bỏ qua cụm khớp nếu ngữ cảnh ngay trước là phủ định ("không nhận ký gửi").
   * Mặc định bật — mọi dấu hiệu đều phải qua cổng này.
   */
  applyNegation?: boolean;
}

/**
 * Tìm 1 cụm từ và trả về TRÍCH DẪN NGUYÊN VĂN của người đăng (giữ nguyên dấu
 * tiếng Việt), để UI hiển thị đúng câu chữ thật thay vì bản đã bỏ dấu.
 *
 * Trả null nếu không thấy khớp nào hợp lệ.
 */
export function findPhrase(
  original: string,
  listing: NormalizedListing,
  phrase: string,
  options: FindPhraseOptions = {},
): PhraseMatch | null {
  const needle = normalizeListing(phrase);
  if (!needle) return null;

  const { excludeIfPrecededBy, applyNegation = true } = options;

  let from = 0;
  for (;;) {
    const at = listing.normalized.indexOf(needle, from);
    if (at === -1) return null;

    const excluded =
      excludeIfPrecededBy && excludeIfPrecededBy.length > 0
        ? precededByAny(listing.normalized, at, excludeIfPrecededBy)
        : false;

    const negated = applyNegation ? isNegated(original, listing, at) : false;

    if (!excluded && !negated) {
      // Ánh xạ chỉ số đầu/cuối về chuỗi gốc rồi cắt trên bản gốc.
      const startOriginal = listing.map[at];
      const endOriginal = listing.endMap[at + needle.length - 1];
      const quote = original.slice(startOriginal, endOriginal).replace(/\s+/g, " ").trim();
      return { quote, index: startOriginal, end: endOriginal };
    }

    from = at + needle.length;
  }
}

/**
 * Biến thể viết liền không dấu ("chinhchu"). Chỉ áp dụng cho số ít cụm đặc
 * trưng — KHÔNG mở rộng thành lớp NLP riêng.
 */
export function findGluedVariant(
  original: string,
  listing: NormalizedListing,
  variants: readonly string[],
): PhraseMatch | null {
  for (const v of variants) {
    const at = listing.normalized.indexOf(v);
    if (at === -1) continue;
    const startOriginal = listing.map[at];
    const endOriginal = listing.endMap[at + v.length - 1];
    const quote = original.slice(startOriginal, endOriginal).replace(/\s+/g, " ").trim();
    return { quote, index: startOriginal, end: endOriginal };
  }
  return null;
}

/**
 * Đếm số lần xuất hiện của một cụm. Dùng để biết người đăng có nhắc lại nhiều
 * lần — KHÔNG dùng số lần làm trọng số điểm.
 *
 * Lưu ý: đếm trên bản chuẩn hoá nên phải chuẩn hoá cả cụm tìm kiếm.
 */
export function countPhrase(listing: NormalizedListing, phrase: string): number {
  const needle = normalizeListing(phrase);
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = listing.normalized.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}
