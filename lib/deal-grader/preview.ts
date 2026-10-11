// Deal Grader (PHASE 3) — chấm nhanh tin đăng trước khi gọi.
//
// Nguyên tắc:
// - Bản "Chấm nhanh" chạy HOÀN TOÀN trên máy người dùng: gọi analyzeListing()
//   của engine deterministic đang chạy production. Không AI, không fetch,
//   không ghi DB, không tiêu quota.
// - Không có công thức chấm mới. Điểm, 6 chỉ số và danh sách lý do đều lấy từ
//   engine hiện có (analyzeListing + scoreContributions) để một tin không có
//   hai bộ số khác nhau giữa trang chủ và trang này.
// - Không phân loại chủ nhà / người môi giới. Repo chưa có model đó, và suy ra
//   từ SĐT hay câu chữ chỉ là bịa dữ liệu.
// - Mọi chuỗi sinh ra ở đây phải vượt FORBIDDEN_DEAL_CLAIMS (test khoá lại).

import { analyzeListing } from "@/lib/scoring";
import { scoreContributions, type ScoreContribution } from "@/lib/score-explain";
import type { ActionType, AnalysisResult } from "@/lib/types";

/** Sàn/trần độ dài nội dung tin. Trần khớp chuẩn sản phẩm hiện tại (1000). */
export const MIN_LISTING_LENGTH = 20;
export const MAX_LISTING_LENGTH = 1000;

export type SignalTone = "green" | "yellow" | "red" | "neutral";

/** hot -> Nên gọi, ok -> Cần kiểm tra thêm, skip -> Bỏ qua (đúng semantics hành động sẵn có). */
export type DealVerdict = "call" | "check" | "skip";

export const VERDICT_LABEL: Record<DealVerdict, string> = {
  call: "Nên gọi",
  check: "Cần kiểm tra thêm",
  skip: "Bỏ qua",
};

export const VERDICT_FROM_ACTION: Record<ActionType, DealVerdict> = {
  hot: "call",
  ok: "check",
  skip: "skip",
};

export function verdictFor(actionType: ActionType): DealVerdict {
  return VERDICT_FROM_ACTION[actionType];
}

/** Nhãn nguồn điểm. "Chấm nhanh" KHÔNG được gọi là AI. */
export const QUICK_SOURCE_LABEL = "ĐIỂM NHANH · CHƯA DÙNG AI";
export const AI_SOURCE_LABEL = "PHÂN TÍCH BẰNG AI";

export const DEAL_GRADER_DISCLAIMER =
  "CheckBDS giúp sàng lọc tín hiệu từ nội dung tin đăng. Kết quả không thay thế việc xác minh người bán, hồ sơ pháp lý, quy hoạch, giá thị trường hoặc khảo sát thực tế trước khi giao dịch.";

/** Quota của đường AI: dùng đúng quota tài khoản hiện có, không có hạn mức riêng. */
export const AI_QUOTA_NOTE =
  "AI dùng quota CheckBDS hiện tại của tài khoản bạn (miễn phí 20 lượt/ngày, Pro 500 lượt/ngày). Không có hạn mức riêng cho công cụ này.";

/**
 * Cụm từ KHÔNG được xuất hiện trong output do Deal Grader sinh ra.
 * Bao gồm cả phân loại chủ nhà / người môi giới (chưa có model, không được bịa)
 * và mọi khẳng định tuyệt đối về pháp lý / giá.
 */
export const FORBIDDEN_DEAL_CLAIMS = [
  "chính chủ",
  "môi giới",
  "tin thật",
  "pháp lý sạch",
  "đủ pháp lý",
  "giá chuẩn",
  "giá thị trường chính xác",
  "định giá thật",
  "cam kết",
  "đảm bảo",
  "an toàn",
] as const;

export interface DealSignal {
  key: "urgency" | "legal" | "price" | "location" | "liquidity" | "confidence";
  label: string;
  value: string;
  note: string;
  tone: SignalTone;
}

export type DealGradeSource = "quick" | "ai";

export interface DealGrade {
  source: DealGradeSource;
  sourceLabel: string;
  score: number;
  verdict: DealVerdict;
  verdictLabel: string;
  verdictTone: SignalTone;
  signals: DealSignal[];
  reasons: ScoreContribution[];
  nextSteps: string[];
  extracted: { price: string; area: string; street: string };
  disclaimer: string;
}

/** Nội dung tin đủ dài để chấm. Khớp sàn mà /api/check cũng yêu cầu. */
export function isGradeableListing(text: string): boolean {
  return typeof text === "string" && text.trim().length >= MIN_LISTING_LENGTH;
}

function toneForUrgency(score: number): SignalTone {
  if (score > 70) return "green";
  if (score > 40) return "yellow";
  return "neutral";
}

function toneForLegal(score: number): SignalTone {
  if (score > 80) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

function toneForGrowth(score: number): SignalTone {
  if (score > 85) return "green";
  if (score > 65) return "yellow";
  return "neutral";
}

function toneForLiquidity(score: number): SignalTone {
  if (score > 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

function legalSignalValue(score: number): string {
  if (score > 80) return "Tín hiệu cao";
  if (score >= 40) return "Trung bình";
  return "Tín hiệu thấp";
}

/**
 * Mô tả chênh lệch giá bằng lời thận trọng. Chênh lệch này đọc từ câu chữ
 * trong tin đăng, KHÔNG phải định giá thị trường — nên không được viết như
 * một kết luận giá.
 */
export function cautiousPriceWording(diffPercent: number): string {
  if (diffPercent > 0) return "Tin đang mô tả mức giá thấp hơn mặt bằng";
  if (diffPercent < 0) return "Tin đang mô tả mức giá cao hơn mặt bằng";
  return "Tin không nêu chênh lệch giá";
}

/** Ghi chú giá: chỉ dùng con số tính được từ chính nội dung tin. */
export function priceSignalNote(detail: string): string {
  return detail.includes("~")
    ? `${detail} — tính từ giá và diện tích ghi trong tin`
    : "Dựa trên nội dung tin đăng, chưa đối chiếu dữ liệu giá thị trường.";
}

const NEXT_STEPS: Record<DealVerdict, string[]> = {
  call: [
    "Gọi hỏi lý do bán và thời hạn cần bán.",
    "Yêu cầu xem sổ gốc, đối chiếu tên người bán với giấy tờ tùy thân.",
    "Tra quy hoạch và kiểm tra thế chấp trước khi bàn cọc.",
  ],
  check: [
    "Gọi hỏi kỹ lý do bán và mức giá còn thương lượng được không.",
    "Yêu cầu xem sổ và tự tra quy hoạch tại địa phương.",
    "So thêm vài tin cùng khu vực trước khi quyết định.",
  ],
  skip: [
    "Đọc lại các điểm cần kiểm tra bên dưới trước khi bỏ qua hẳn.",
    "Nếu vẫn quan tâm, yêu cầu người bán cung cấp giấy tờ gốc để xác minh.",
    "Ưu tiên tin khác có tín hiệu rõ ràng hơn.",
  ],
};

const VERDICT_TONE: Record<DealVerdict, SignalTone> = {
  call: "green",
  check: "yellow",
  skip: "red",
};

export interface DealGradeInput {
  result: AnalysisResult;
  source: DealGradeSource;
  /** Confidence 0..1 do AI trả về. Chỉ có ở đường AI, và chỉ khi provider trả số. */
  confidence?: number | null;
}

/**
 * Dựng view-model hiển thị từ 1 AnalysisResult. Dùng CHUNG cho cả bản chấm
 * nhanh và bản AI: `fromApiResponse` đã merge sub-score của AI vào đúng 4 ô
 * breakdown, nên chỉ cần đổi `source` là ra bản AI — không có bảng số thứ hai.
 */
export function buildDealGrade(input: DealGradeInput): DealGrade {
  const { result, source } = input;
  const b = result.breakdown;
  const verdict = verdictFor(result.actionType);

  const signals: DealSignal[] = [
    {
      key: "urgency",
      label: "DẤU HIỆU BÁN GẤP",
      value: `${b.ngop.score}/100`,
      note: b.ngop.detail,
      tone: toneForUrgency(b.ngop.score),
    },
    {
      key: "legal",
      label: "PHÁP LÝ (THEO NỘI DUNG TIN)",
      value: legalSignalValue(b.phapLy.score),
      note: `${b.phapLy.detail}. Cần tự xác minh sổ và quy hoạch.`,
      tone: toneForLegal(b.phapLy.score),
    },
    {
      key: "price",
      label: "TÍN HIỆU GIÁ TỪ NỘI DUNG TIN",
      value: cautiousPriceWording(b.giaThiTruong.diffPercent),
      note: priceSignalNote(b.giaThiTruong.detail),
      tone: "neutral",
    },
    {
      key: "location",
      label: "VỊ TRÍ / TIỀM NĂNG KHU VỰC",
      value: `${b.viTri.score}/100`,
      note: b.viTri.detail,
      tone: toneForGrowth(b.viTri.score),
    },
    {
      key: "liquidity",
      label: "THANH KHOẢN",
      value: `${b.thanhKhoan.score}/100`,
      note: b.thanhKhoan.detail,
      tone: toneForLiquidity(b.thanhKhoan.score),
    },
  ];

  // Confidence chỉ có ở đường AI, và chỉ khi provider thật sự trả số 0..1.
  const conf = input.confidence;
  if (typeof conf === "number" && Number.isFinite(conf) && conf >= 0 && conf <= 1) {
    signals.push({
      key: "confidence",
      label: "ĐỘ TIN CẬY MODEL",
      value: `${Math.round(conf * 100)}%`,
      note: "Mức độ tin cậy model trả về cho lần chấm này, không phải xác suất tin là thật.",
      tone: "neutral",
    });
  }

  return {
    source,
    sourceLabel: source === "ai" ? AI_SOURCE_LABEL : QUICK_SOURCE_LABEL,
    score: result.overall,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    verdictTone: VERDICT_TONE[verdict],
    signals,
    reasons: scoreContributions(result),
    nextSteps: NEXT_STEPS[verdict],
    extracted: result.extracted,
    disclaimer: DEAL_GRADER_DISCLAIMER,
  };
}

/**
 * Điểm vào của bản chấm nhanh. ĐỒNG BỘ và thuần: không fetch, không đọc
 * storage, không gọi AI, không chạm Supabase. Trả null khi tin quá ngắn.
 */
export function quickGrade(text: string): DealGrade | null {
  if (!isGradeableListing(text)) return null;
  return buildDealGrade({ result: analyzeListing(text), source: "quick" });
}

