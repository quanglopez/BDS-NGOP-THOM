// Owner/Broker signal tool (PHASE 4) — phân loại dấu hiệu trong nội dung tin.
//
// THUẦN + ĐỒNG BỘ: không fetch, không await, không Supabase, không DB,
// không đọc storage. Cùng input -> cùng output.
//
// Đây KHÔNG phải công cụ xác minh danh tính. Nó trả lời câu hỏi hẹp hơn:
// "câu chữ trong tin này giống cách ai thường viết hơn?".
//
// Quy tắc quyết định (cố ý bảo thủ, không có điểm số):
//   broker_like  : >= 1 dấu hiệu STRONG
//                  HOẶC >= 2 dấu hiệu MEDIUM độc lập
//   owner_like   : >= 2 dấu hiệu MEDIUM độc lập
//                  VÀ không có dấu hiệu STRONG nào của phía broker
//   còn lại      : insufficient
//
// Dấu hiệu WEAK không bao giờ quyết định. Hai bên cùng có bằng chứng mạnh
// (broker STRONG + owner MEDIUM) -> insufficient, và hiển thị CẢ HAI nhóm.
// Không trừ hai bên thành một con số.

import {
  signalsForSide,
  type SignalDefinition,
  type SignalSide,
  type SignalStrength,
} from "./signals";
import {
  findAllPhraseCandidates,
  findGluedVariant,
  normalizeListing,
  normalizeWithMap,
  type NormalizedListing,
  type PhraseMatch,
} from "./normalize";
import type { Classification, EvidenceLevel } from "./wording";
import { VERIFY_QUESTIONS } from "./wording";

/** Sàn độ dài: dưới ngưỡng này không đủ ngữ cảnh để phân tích. */
export const MIN_LISTING_LENGTH = 20;
/** Trần độ dài: khớp chuẩn sản phẩm hiện tại của repo (1000). */
export const MAX_LISTING_LENGTH = 1000;

/** Một dấu hiệu đã tìm thấy trong nội dung tin. */
export interface MatchedSignal {
  id: string;
  side: SignalSide;
  strength: SignalStrength;
  label: string;
  means: string;
  /** Cụm NGUYÊN VĂN cắt từ văn bản người dùng dán. */
  quote: string;
  /** Số lần cụm xuất hiện trong tin (chỉ để hiển thị, không tính điểm). */
  occurrences: number;
  /** Vị trí trong văn bản gốc — dùng để phát hiện chồng lấn. */
  start: number;
  end: number;
}

/** MatchedSignal kèm dấu hiệu đã bị gộp do chồng lấn hay chưa. */
export interface OwnerSignalResult {
  classification: Classification;
  evidenceLevel: EvidenceLevel;
  brokerSignals: MatchedSignal[];
  ownerSignals: MatchedSignal[];
  /** true khi hai bên cùng có bằng chứng mạnh -> không nghiêng về bên nào. */
  conflicting: boolean;
  /** Giải thích vì sao ra kết quả này — luôn có, kể cả khi insufficient. */
  why: string;
  /** Câu hỏi để người dùng tự xác minh khi gặp người bán. */
  questions: string[];
}

/**
 * Tìm mọi dấu hiệu khớp trong văn bản.
 *
 * Ba cổng lọc:
 *  - PHỦ ĐỊNH: "tôi không nhận ký gửi" không được tính là hoạt động nhận ký gửi.
 *  - NGỮ CẢNH ĐỨNG TRƯỚC (excludeIfPrecededBy): chặn cụm lồng nhau như
 *    "công ty tôi cần bán" khớp nhầm thành dấu hiệu người bán cá nhân.
 *  - KHÔNG HỒI SINH QUA VÙNG BỊ PHỦ ĐỊNH: nếu một pattern bị phủ định, mọi
 *    pattern khác CÙNG định nghĩa nằm chồng lấn trong vùng đó cũng bị chặn.
 *
 * Cổng thứ ba là cần thiết vì một định nghĩa có nhiều pattern thay thế:
 * "nhận ký gửi" và "ký gửi nhà". Khi câu là "không bao giờ nhận ký gửi nhà",
 * pattern dài bị phủ định đúng, nhưng pattern ngắn hơn bắt đầu MUỘN HƠN một
 * token nên từ phủ định rơi ra ngoài tầm với của nó — và dấu hiệu hồi sinh
 * thành khẳng định. Ghi lại vùng bị phủ định rồi chặn mọi cụm chồng lấn giải
 * quyết việc này một cách tổng quát, không cần special-case câu cụ thể.
 */
function collectMatches(
  original: string,
  listing: NormalizedListing,
  defs: readonly SignalDefinition[],
): MatchedSignal[] {
  const out: MatchedSignal[] = [];

  for (const def of defs) {
    const options = { excludeIfPrecededBy: def.excludeIfPrecededBy };

    // Thu mọi ứng viên của MỌI pattern trong định nghĩa này.
    const candidates = def.patterns.flatMap((pattern) =>
      findAllPhraseCandidates(original, listing, pattern, options),
    );

    // Vùng bị phủ định (hoặc bị ngữ cảnh trước chặn) — mọi cụm chồng lấn với
    // vùng này thuộc cùng định nghĩa đều không được hồi sinh.
    const suppressedSpans = candidates.filter((c) => c.suppressed);

    const accepted = candidates.find(
      (c) => !c.suppressed && !overlapsAny(c, suppressedSpans),
    );

    let match: PhraseMatch | null = accepted
      ? { quote: accepted.quote, index: accepted.index, end: accepted.end }
      : null;

    // Biến thể viết liền đi qua cùng cổng phủ định.
    if (!match && def.glued) {
      match = findGluedVariant(original, listing, def.glued, options);
    }
    if (!match) continue;

    out.push({
      id: def.id,
      side: def.side,
      strength: def.strength,
      label: def.label,
      means: def.means,
      quote: match.quote,
      occurrences: countOccurrences(listing, def),
      start: match.index,
      end: match.end,
    });
  }

  return out;
}

/** Cụm này có chồng lấn (hoặc nằm trong) một trong các vùng đã cho không? */
function overlapsAny(
  candidate: { index: number; end: number },
  spans: readonly { index: number; end: number }[],
): boolean {
  return spans.some((s) => candidate.index < s.end && s.index < candidate.end);
}

function countOccurrences(listing: NormalizedListing, def: SignalDefinition): number {
  let total = 0;
  for (const pattern of def.patterns) {
    const needle = normalizeListing(pattern);
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = listing.normalized.indexOf(needle, from);
      if (at === -1) break;
      total += 1;
      from = at + needle.length;
    }
  }
  return total;
}

/** Xếp dấu hiệu theo mức rồi theo thứ tự tìm thấy, để UI ổn định. */
const STRENGTH_ORDER: Record<SignalStrength, number> = { strong: 0, medium: 1, weak: 2 };

function sortSignals(list: MatchedSignal[]): MatchedSignal[] {
  return [...list].sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]);
}

/**
 * Gộp các cụm khớp CHỒNG LẤN của cùng một phía thành một đơn vị bằng chứng.
 *
 * "nhà tôi đang ở" khớp cả "nhà tôi" lẫn "nhà đang ở", nhưng đó là MỘT ý. Nếu
 * tính thành hai, một câu duy nhất tự tạo đủ 2 phiếu MEDIUM và đẩy kết quả sang
 * owner_like một cách giả tạo.
 *
 * Khi chồng lấn, giữ cụm MẠNH HƠN rồi DÀI HƠN (cụ thể hơn). Cụm không chồng lấn
 * vẫn được giữ riêng, nên hai sự việc thật sự khác nhau vẫn tính là hai.
 *
 * Dùng chung cho cả việc đếm lẫn việc hiển thị: nếu chỉ gộp lúc đếm mà vẫn show
 * hai cụm trùng nghĩa, người đọc sẽ hiểu là hai bằng chứng độc lập — đúng cái
 * hiểu nhầm mà quy tắc này sinh ra để tránh.
 */
function dedupeSignals(list: readonly MatchedSignal[]): MatchedSignal[] {
  const ranked = [...list].sort(
    (a, b) =>
      STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept: MatchedSignal[] = [];
  for (const s of ranked) {
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Đếm dấu hiệu ĐỘC LẬP theo mức, trên danh sách ĐÃ gộp chồng lấn.
 */
function countIndependent(list: readonly MatchedSignal[], strength: SignalStrength): number {
  return list.filter((s) => s.strength === strength).length;
}

/**
 * Số dấu hiệu ĐỘC LẬP theo mức — export cho test khẳng định trực tiếp rằng cụm
 * chồng lấn không tạo thêm phiếu.
 */
export function countIndependentSignals(
  list: readonly MatchedSignal[],
  strength: SignalStrength,
): number {
  return countIndependent(list, strength);
}

/**
 * Phân loại dấu hiệu trong nội dung tin.
 *
 * Trả `insufficient` khi: không có dấu hiệu, chỉ có dấu hiệu WEAK, chỉ có 1
 * dấu hiệu MEDIUM, hoặc hai bên cùng có bằng chứng mạnh.
 */
export function classifyOwnerSignals(text: string): OwnerSignalResult | null {
  const original = typeof text === "string" ? text : "";
  if (original.trim().length < MIN_LISTING_LENGTH) return null;

  const listing = normalizeWithMap(original);
  // Gộp chồng lấn NGAY tại đây để cả việc đếm lẫn việc hiển thị dùng cùng một
  // bộ bằng chứng: mỗi cụm hiện ra đúng là một đơn vị độc lập.
  const brokerSignals = dedupeSignals(
    sortSignals(collectMatches(original, listing, signalsForSide("broker"))),
  );
  const ownerSignals = dedupeSignals(
    sortSignals(collectMatches(original, listing, signalsForSide("owner"))),
  );

  // Đếm theo cụm ĐỘC LẬP (đã gộp chồng lấn), không đếm thô.
  const brokerStrong = countIndependent(brokerSignals, "strong");
  const brokerMedium = countIndependent(brokerSignals, "medium");
  const ownerMedium = countIndependent(ownerSignals, "medium");

  const brokerPositive = brokerStrong >= 1 || brokerMedium >= 2;
  const ownerPositive = ownerMedium >= 2;

  // Hai bên cùng có bằng chứng thật -> KHÔNG nghiêng về bên nào.
  // Bao gồm cả trường hợp lệch mức (STRONG broker + MEDIUM owner) lẫn trường
  // hợp cân bằng (2 MEDIUM broker + 2 MEDIUM owner): cả hai đều là mâu thuẫn,
  // và mâu thuẫn thì không được phép chọn bừa một bên.
  const conflicting =
    (brokerStrong >= 1 && ownerMedium >= 1) || (brokerPositive && ownerPositive);

  let classification: Classification;
  if (conflicting) {
    classification = "insufficient";
  } else if (brokerPositive) {
    classification = "broker_like";
  } else if (ownerPositive) {
    classification = "owner_like";
  } else {
    classification = "insufficient";
  }

  const evidenceLevel = levelFor(classification, brokerSignals, ownerSignals);
  const why = explain(classification, {
    brokerStrong,
    brokerMedium,
    ownerMedium,
    conflicting,
    brokerSignals,
    ownerSignals,
  });

  return {
    classification,
    evidenceLevel,
    brokerSignals,
    ownerSignals,
    conflicting,
    why,
    // Gợi ý tự xác minh. Luôn trả về, kể cả khi insufficient — người dùng vẫn
    // cần biết nên hỏi gì khi gặp người bán.
    questions: [...VERIFY_QUESTIONS],
  };
}

function levelFor(
  classification: Classification,
  brokerSignals: MatchedSignal[],
  ownerSignals: MatchedSignal[],
): EvidenceLevel {
  if (classification === "insufficient") return "insufficient";
  const relevant = classification === "broker_like" ? brokerSignals : ownerSignals;
  const decisive =
    classification === "broker_like"
      ? countIndependent(relevant, "strong") >= 2 ||
        (countIndependent(relevant, "strong") >= 1 && countIndependent(relevant, "medium") >= 1)
      : countIndependent(relevant, "medium") >= 3;
  return decisive ? "many" : "some";
}

interface ExplainInput {
  brokerStrong: number;
  brokerMedium: number;
  ownerMedium: number;
  conflicting: boolean;
  brokerSignals: MatchedSignal[];
  ownerSignals: MatchedSignal[];
}

/**
 * Giải thích bằng lời, KHÔNG có phần trăm. Luôn nói rõ căn cứ là câu chữ
 * trong tin, và không kết luận người đăng là ai.
 */
function explain(classification: Classification, input: ExplainInput): string {
  const { brokerStrong, brokerMedium, ownerMedium, conflicting } = input;

  if (conflicting) {
    return "Nội dung tin vừa có dấu hiệu cho thấy người viết rao hộ tài sản, vừa có dấu hiệu cho thấy tài sản gắn với người viết. Hai hướng cùng xuất hiện nên chưa kết luận được gì từ câu chữ.";
  }

  if (classification === "broker_like") {
    if (brokerStrong >= 1) {
      return "Nội dung tin có cụm từ mô tả hoạt động bán hộ hoặc có nhiều sản phẩm cùng lúc — cách viết này thường gặp ở tin do bên bán hàng đăng.";
    }
    return `Nội dung tin có ${brokerMedium} dấu hiệu dịch vụ bán hàng độc lập — nhiều hơn một chi tiết đơn lẻ nên nghiêng về cách viết của bên bán hàng.`;
  }

  if (classification === "owner_like") {
    return `Nội dung tin có ${ownerMedium} dấu hiệu gắn tài sản với người viết hoặc gia đình, và không có dấu hiệu bán hộ nào.`;
  }

  // insufficient — nói rõ vì sao, để người đọc không hiểu "chưa đủ" là "đã kiểm tra".
  if (input.brokerSignals.length === 0 && input.ownerSignals.length === 0) {
    return "Không tìm thấy cụm từ đặc trưng nào trong nội dung tin. Không có dấu hiệu không có nghĩa là tin đã được xác minh.";
  }
  if (brokerStrong >= 1 && ownerMedium === 0) {
    return "Có dấu hiệu bán hộ nhưng chưa đủ để kết luận, và không có dấu hiệu nào khác hỗ trợ.";
  }
  if (ownerMedium === 1 && brokerStrong === 0 && brokerMedium < 2) {
    return "Chỉ có một dấu hiệu gắn tài sản với người viết. Một chi tiết đơn lẻ chưa đủ để nghiêng về hướng nào.";
  }
  return "Các dấu hiệu tìm thấy đều ở mức yếu hoặc không đủ số lượng độc lập để kết luận. Lời tự khai trong tin không được tính là bằng chứng.";
}
