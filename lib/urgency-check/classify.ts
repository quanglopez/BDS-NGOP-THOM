// Urgency Verification Checklist (PHASE 6) — phân loại dấu hiệu "bán gấp".
//
// THUẦN + ĐỒNG BỘ: không fetch, không await, không Supabase, không React.
// Cùng input -> cùng output.
//
// Đây KHÔNG phải công cụ xác minh lý do bán. Nó trả lời câu hỏi hẹp hơn:
// "câu chữ trong tin có dùng ngôn ngữ bán gấp không?".
//
// Tái sử dụng engine phủ định đã kiểm chứng của Phase 4 (lib/owner-signals/
// normalize.ts) — chỉ đọc, không sửa. Nhờ vậy "không bán gấp" không bị tính,
// còn "Không bán căn cũ. Bán gấp căn này." vẫn nhận ra dấu hiệu thật vì dấu
// chấm cắt mệnh đề.
//
// Quy tắc quyết định (không có điểm số):
//   verify_soon  : >= 1 dấu hiệu STRONG độc lập
//                  HOẶC >= 2 dấu hiệu MEDIUM độc lập
//   còn lại      : insufficient
//
// Dấu hiệu WEAK (ngôn ngữ quảng cáo) không bao giờ quyết định và không hiện
// làm bằng chứng.

import {
  findAllPhraseCandidates,
  normalizeWithMap,
  type NormalizedListing,
  type PhraseCandidate,
} from "@/lib/owner-signals/normalize";
import {
  DECIDING_SIGNALS,
  type UrgencyLevel,
  type UrgencySignalDefinition,
  type UrgencyTier,
  type UrgencyTopic,
} from "./signals";
import {
  CHECKLIST,
  CONDITIONAL_QUESTIONS,
  LEVEL_EXPLANATION,
  LEVEL_LABEL,
  LIMITATION,
  PHYSICAL_CHECKS,
  TOPIC_ORDER,
  WATCH_FOR,
  contextNote,
} from "./wording";

/** Sàn/trần độ dài nội dung tin. Trần khớp chuẩn sản phẩm hiện tại (1000). */
export const MIN_LISTING_LENGTH = 20;
export const MAX_LISTING_LENGTH = 1000;

export interface UrgencyEvidence {
  signalId: string;
  tier: UrgencyTier;
  topic: UrgencyTopic;
  /** Cụm NGUYÊN VĂN cắt từ văn bản người dùng dán (giữ nguyên dấu và hoa/thường). */
  quote: string;
  start: number;
  end: number;
  label: string;
  reason: string;
}

export interface UrgencyCheckResult {
  level: UrgencyLevel;
  levelLabel: string;
  explanation: string;
  evidence: UrgencyEvidence[];
  /** Số dấu hiệu độc lập theo mức, sau khi gộp chồng lấn. */
  independentStrong: number;
  independentMedium: number;
  questions: string[];
  watchFor: string[];
  physicalChecks: string[];
  limitation: string;
  /** Ghi chú ngữ cảnh — chỉ hiện khi caller truyền giá trị vào. */
  contextNote: string | null;
}

export interface UrgencyCheckInput {
  text: string;
  /** Ngữ cảnh hiển thị. KHÔNG ảnh hưởng mức kết luận. */
  isNgop?: number | null;
  dealType?: string | null;
}

/**
 * Tìm ứng viên khớp cho mọi định nghĩa quyết định.
 *
 * Cổng lọc phủ định chạy bên trong `findAllPhraseCandidates` (Phase 4):
 * cụm bị phủ định bị đánh dấu `suppressed` và không bao giờ vào bằng chứng.
 */
function collectCandidates(
  original: string,
  listing: NormalizedListing,
  defs: readonly UrgencySignalDefinition[],
): Array<{ def: UrgencySignalDefinition; candidate: PhraseCandidate }> {
  const out: Array<{ def: UrgencySignalDefinition; candidate: PhraseCandidate }> = [];

  for (const def of defs) {
    for (const pattern of def.patterns) {
      const candidates = findAllPhraseCandidates(original, listing, pattern, {
        excludeIfPrecededBy: def.excludeIfPrecededBy,
      });
      for (const c of candidates) out.push({ def, candidate: c });
    }
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

/** Mức mạnh hơn được ưu tiên khi hai cụm chồng lấn. */
const TIER_RANK: Record<UrgencyTier, number> = { strong: 0, medium: 1, weak: 2 };

/**
 * Chọn bằng chứng cuối cùng từ danh sách ứng viên.
 *
 * Bốn việc, theo thứ tự:
 * 1. BỎ cụm bị phủ định — chúng không bao giờ là bằng chứng.
 * 2. KHÔNG HỒI SINH: cụm chồng lấn với một vùng đã bị phủ định cũng bị bỏ, dù
 *    bản thân nó nằm ngoài tầm với của từ phủ định. Cần thiết vì catalog có
 *    nhiều pattern lồng nhau ("cần tiền gấp" chứa "cần tiền").
 * 3. GỘP CHỒNG LẤN giữa các cụm hợp lệ: giữ cụm mạnh hơn rồi dài hơn (cụ thể
 *    hơn). Nhờ vậy "cần tiền gấp" là MỘT đơn vị bằng chứng, không phải
 *    STRONG + MEDIUM.
 * 4. MỘT ĐƠN VỊ CHO MỖI ĐỊNH NGHĨA: nhắc lại cùng một cụm ở nhiều chỗ không
 *    tạo thêm phiếu. Nếu không chặn, "bán gấp" xuất hiện 3 lần trong một tin sẽ
 *    thành 3 dấu hiệu STRONG độc lập — đúng kiểu thổi phồng số lượng mà yêu cầu
 *    "no inflated signal count" muốn tránh. Giữ lần xuất hiện SỚM NHẤT để trích
 *    dẫn ổn định.
 */
function selectEvidence(
  original: string,
  pairs: Array<{ def: UrgencySignalDefinition; candidate: PhraseCandidate }>,
): UrgencyEvidence[] {
  const suppressedSpans = pairs
    .filter((p) => p.candidate.suppressed)
    .map((p) => p.candidate);

  const accepted = pairs
    .filter((p) => !p.candidate.suppressed && !overlapsAny(p.candidate, suppressedSpans))
    .map((p) => ({
      def: p.def,
      candidate: p.candidate,
      length: p.candidate.end - p.candidate.index,
    }));

  // Mạnh hơn trước, rồi dài hơn, rồi vị trí sớm hơn — thứ tự tất định.
  const ranked = [...accepted].sort(
    (a, b) =>
      TIER_RANK[a.def.tier] - TIER_RANK[b.def.tier] ||
      b.length - a.length ||
      a.candidate.index - b.candidate.index,
  );

  const kept: typeof ranked = [];
  const usedDefs = new Set<string>();
  for (const item of ranked) {
    if (usedDefs.has(item.def.id)) continue;
    if (kept.some((k) => overlapsAny(item.candidate, [k.candidate]))) continue;
    kept.push(item);
    usedDefs.add(item.def.id);
  }

  return kept
    .sort((a, b) => a.candidate.index - b.candidate.index)
    .map((item) => ({
      signalId: item.def.id,
      tier: item.def.tier,
      topic: item.def.topic,
      quote: item.candidate.quote,
      start: item.candidate.index,
      end: item.candidate.end,
      label: item.def.label,
      reason: item.def.reason,
    }));
}

/** Câu hỏi: checklist cố định + câu có điều kiện theo nhóm, không trùng. */
function buildQuestions(evidence: readonly UrgencyEvidence[]): string[] {
  const topics = new Set<UrgencyTopic>(evidence.map((e) => e.topic));
  const conditional = TOPIC_ORDER.filter((t) => topics.has(t)).map((t) => CONDITIONAL_QUESTIONS[t]);
  return [...CHECKLIST, ...conditional];
}

/**
 * Phân loại dấu hiệu bán gấp trong nội dung tin.
 *
 * Trả `null` khi tin quá ngắn để phân tích.
 */
export function checkUrgency(input: UrgencyCheckInput): UrgencyCheckResult | null {
  const original = typeof input?.text === "string" ? input.text : "";
  if (original.trim().length < MIN_LISTING_LENGTH) return null;

  const listing = normalizeWithMap(original);
  const evidence = selectEvidence(original, collectCandidates(original, listing, DECIDING_SIGNALS));

  const independentStrong = evidence.filter((e) => e.tier === "strong").length;
  const independentMedium = evidence.filter((e) => e.tier === "medium").length;

  const level: UrgencyLevel =
    independentStrong >= 1 || independentMedium >= 2 ? "verify_soon" : "insufficient";

  return {
    level,
    levelLabel: LEVEL_LABEL[level],
    explanation: LEVEL_EXPLANATION[level],
    evidence,
    independentStrong,
    independentMedium,
    questions: buildQuestions(evidence),
    // watchFor / physicalChecks là danh sách cố định, không phụ thuộc dấu hiệu.
    // Sao chép ra mảng mới để caller không sửa được mảng gốc.
    watchFor: [...WATCH_FOR],
    physicalChecks: [...PHYSICAL_CHECKS],
    limitation: LIMITATION,
    // Ngữ cảnh CHỈ để hiển thị — không tham gia tính `level`.
    contextNote: contextNote(input.isNgop, input.dealType),
  };
}
