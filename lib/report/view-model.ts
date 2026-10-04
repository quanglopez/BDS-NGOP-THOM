// ReportViewModel — ADAPTER DUY NHẤT giữa raw backend và UI report.
//
//   raw backend -> buildReportViewModel() -> ReportViewModel -> component
//
// Vì sao cần lớp này:
//  1. null ≠ 0. Backend có thể không biết (score null, deal_type null,
//     is_ngop null). Component đọc raw sẽ dễ rơi vào falsy-check rồi hiện số 0
//     — tức hiện kết luận thật cho 1 thứ chưa biết.
//  2. Vocabulary khác nhau ở 3 nơi: check.confidence là số 0..1, Pro Analysis
//     dùng low|medium|high, Price Intelligence cũng low|medium|high. Adapter
//     gộp về 1 mức trình bày mà KHÔNG đổi DB và KHÔNG đổi API response.
//  3. Trạng thái rải rác: chưa tải / đang phân tích / xong / thiếu một phần /
//     lỗi. Component tự suy từ HTTP status là mỗi chỗ một logic.
//
// Nguyên tắc: file này KHÔNG tạo dữ liệu. Mọi trường đều "null = chưa biết",
// và khi chưa biết thì `display` là câu nói rõ điều đó cho người đọc.
import { DEAL_UNKNOWN_LABEL, DEAL_LABELS } from "@/lib/format";
import { normalizeAutoConfidence } from "@/lib/radar/auto-enrollment";
import { CONFIDENCE_META, type PriceIntelligence } from "@/lib/price/types";
import type { ProAnalysis } from "@/lib/ai/schema";
import { canShowStatistics } from "@/lib/price/pipeline";
import { buildEntitlement, type Entitlement } from "./entitlement";

// ---------------------------------------------------------------- vocabulary

export type ConfidenceLevel = "low" | "medium" | "high";

/** Trạng thái report ở tầng trình bày. Không persist — suy ra từ response. */
export type ReportStatus =
  | "loading"
  | "analyzing"
  | "ready"
  | "partial"
  | "failed"
  | "listing_unavailable";

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

export type ImageLoadState = "no_images" | "images_all_failed" | "image_available";

/** Mọi field "chưa biết" đều có `known: false` để component quyết định hiển thị
 *  thay vì tự đoán. `display` luôn là chuỗi để render không phải null-check. */
export interface Normalized<T> {
  value: T | null;
  known: boolean;
  display: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Số hợp lệ trong [min,max] -> number, ngược lại null. KHÔNG có default. */
function boundedNumber(v: unknown, min: number, max: number): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) return v;
  return null;
}

// ------------------------------------------------------------------- score

export const SCORE_UNKNOWN_DISPLAY = "Chưa chấm điểm";

/**
 * Điểm 0..100.
 *   null      -> known:false, "Chưa chấm điểm"   (chưa ai chấm)
 *   0         -> known:true,  "0/100"             (điểm 0 là kết luận thật)
 * Giá trị ngoài thang coi như chưa biết — số 147/100 là dữ liệu hỏng, hiện nó
 * còn tệ hơn hiện 0 vì nó trông như một điểm thật.
 */
export function normalizeScore(raw: unknown): Normalized<number> {
  const n = boundedNumber(raw, 0, 100);
  if (n === null) return { value: null, known: false, display: SCORE_UNKNOWN_DISPLAY };
  return { value: n, known: true, display: `${n}/100` };
}

// ---------------------------------------------------------------- deal type

export const DEAL_TYPE_UNKNOWN_DISPLAY = DEAL_UNKNOWN_LABEL;

/**
 * Phân loại kèo.
 *   null / lạ  -> known:false, "CHƯA CÓ NHẬN ĐỊNH"
 *   binh_thuong-> known:true,  "BÌNH THƯỜNG"   (chỉ khi provider THẬT sự trả)
 * Chuỗi rỗng cũng là chưa biết. Giá trị lạ (model đổi nhãn, dữ liệu cũ) KHÔNG
 * rơi về "bình thường" — đó là kết luận, không phải fallback.
 */
export interface DealTypeView extends Normalized<string> {
  /** Giá trị thô provider trả (kể cả nhãn lạ bị từ chối). null khi provider
   *  không trả chuỗi nào. Dùng cho audit/đối chiếu — UI quyết hiển thị theo
   *  `known`/`display`, KHÔNG đọc field này. */
  raw: string | null;
}

export function normalizeDealType(raw: unknown): DealTypeView {
  const rawChoice = typeof raw === "string" && raw.trim() !== "" ? raw : null;
  if (!rawChoice) {
    return { value: null, known: false, display: DEAL_TYPE_UNKNOWN_DISPLAY, raw: null };
  }
  const label = DEAL_LABELS[rawChoice];
  if (label === undefined) {
    return { value: null, known: false, display: DEAL_TYPE_UNKNOWN_DISPLAY, raw: rawChoice };
  }
  return { value: rawChoice, known: true, display: label, raw: rawChoice };
}

// ------------------------------------------------------------------ is_ngop

export const IS_NGOP_UNKNOWN_DISPLAY = "Chưa xác định";

/**
 * Mức ngộp 0..100.
 *   null -> known:false, "Chưa xác định"   (provider không trả noul)
 *   0    -> known:true,  "Không"           (provider nói: không ngộp)
 * 0 là kết luận thật nên KHÔNG được nhập chung với "chưa biết".
 */
export function normalizeIsNgop(raw: unknown): Normalized<number> {
  const n = boundedNumber(raw, 0, 100);
  if (n === null) return { value: null, known: false, display: IS_NGOP_UNKNOWN_DISPLAY };
  if (n === 0) return { value: 0, known: true, display: "Không" };
  return { value: n, known: true, display: `Có (${n}/100)` };
}

// --------------------------------------------------------------- confidence

const CONFIDENCE_DISPLAY: Record<ConfidenceLevel, string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
};

export interface ConfidenceView extends Normalized<ConfidenceLevel> {
  /** Giá trị số gốc 0..1 của check.confidence. Giữ lại để audit/đối chiếu —
   *  quy về 3 mức là mất thông tin, nên adapter không xoá. */
  raw: number | null;
  badge: string | null;
}

/** Ngưỡng quy đổi confidence số 0..1 -> low|medium|high. KHÔNG định nghĩa lại:
 *  ủy quyền cho `normalizeAutoConfidence` (lib/radar/auto-enrollment.ts) —
 *  ngưỡng DUY NHẤT của repo (>=0.8 high, >=0.55 medium) để một tin không đổi
 *  mức giữa màn hình report và thẻ Radar khi ai đó chỉnh ngưỡng ở một nơi. */
export function normalizeConfidenceLevel(raw: unknown): ConfidenceLevel | null {
  return normalizeAutoConfidence(raw);
}

/**
 * Confidence từ 1 trong 3 nguồn khác nhau:
 *   - `numeric` — check.confidence (số 0..1)
 *   - `level`   — Pro Analysis / Price Intelligence (low|medium|high)
 * Ưu tiên `level` khi có (nó là từ chính module sinh ra nó), thiếu thì quy từ
 * `numeric`. Cả hai thiếu -> chưa biết. Giữ luôn `raw` để không mất số gốc.
 */
export function normalizeConfidence(input: {
  numeric?: unknown;
  level?: unknown;
}): ConfidenceView {
  const raw = boundedNumber(input.numeric, 0, 1);
  const fromLevel = normalizeConfidenceLevel(input.level);
  const level = fromLevel ?? normalizeConfidenceLevel(raw);
  if (!level) {
    return { value: null, known: false, display: "Chưa đánh giá", raw: raw ?? null, badge: null };
  }
  return {
    value: level,
    known: true,
    display: CONFIDENCE_DISPLAY[level],
    raw: raw ?? null,
    badge: CONFIDENCE_META[level as "low" | "medium" | "high"]?.badge ?? null,
  };
}

// ------------------------------------------------------------- report status

export interface StatusInput {
  /** Chưa có response nào. */
  loading?: boolean;
  /** Đã gọi API, đang chờ. */
  analyzing?: boolean;
  /** API trả lỗi / không dùng được. */
  failed?: boolean;
  /** Bản gốc của tin không còn đọc được (đã xoá/hết hạn). */
  listingUnavailable?: boolean;
  /** Report có nhưng thiếu một phần (chưa chấm, price chưa có...). */
  incomplete?: boolean;
}

/**
 * Suy trạng thái report. Thứ tự ưu tiên từ "nặng" xuống "nhẹ": listing hỏng
 * làm report vô nghĩa, nên nó phải thắng mọi trạng thái khác.
 */
export function normalizeReportStatus(input: StatusInput = {}): ReportStatus {
  if (input.listingUnavailable) return "listing_unavailable";
  if (input.failed) return "failed";
  if (input.loading) return "loading";
  if (input.analyzing) return "analyzing";
  if (input.incomplete) return "partial";
  return "ready";
}

const DAY_MS = 86_400_000;

/**
 * Độ mới của dữ liệu. Thiếu mốc thời gian -> "unknown" (KHÔNG coi là mới,
 * vì "vừa mới cập nhật" là một tuyên bố về thời gian mà ta không có).
 */
export function normalizeFreshness(generatedAt: unknown, nowMs: number = Date.now()): Freshness {
  if (typeof generatedAt !== "string" || generatedAt.trim() === "") return "unknown";
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return "unknown";
  const age = nowMs - t;
  if (age < 0) return "unknown";
  if (age <= 2 * DAY_MS) return "fresh";
  if (age <= 14 * DAY_MS) return "aging";
  return "stale";
}

// ------------------------------------------------------------------ evidence

export type EvidenceRefType = "listing_text" | "image" | "calculated" | "market_data";

export type EvidenceSource = "listing_text" | "calculated" | "missing";

export type EvidenceLocation =
  | { kind: "text_span"; start: number; end: number }
  | { kind: "image_index"; index: number }
  | { kind: "calculation"; formula: string }
  | { kind: "market_statistic"; statKey: string; scopeLevel: string };

/**
 * Tham chiếu bằng chứng MỘT tới một nguồn thật.
 *
 * Không có nguồn thật thì `evidenceRefs = []` và UI hiện unavailable.
 * `location` null khi backend chưa ghi span thật — thà để null còn hơn giả.
 */
export interface EvidenceRef {
  id: string;
  type: EvidenceRefType;
  label: string;
  source: EvidenceSource;
  /** Trích đoạn nguyên văn. null = chưa có trích đoạn để hiển thị. */
  excerpt: string | null;
  /** Vị trí TẬT YẾU của nguồn trong nội dung gốc. null = backend chưa lưu
   *  span/index thật — TUYỆT ĐỐI không tự bịa chuỗi giả để hiện. */
  location: EvidenceLocation | null;
}

export interface EvidenceInput {
  /** Tín hiệu backend đã ghi kèm nguồn (EvidenceSignal trong lib/ai/evidence.ts). */
  signals?: { signal: string; detail: string; source: EvidenceSource }[];
  /** Có text gốc để định vị span không. Không có -> không tạo span giả. */
  listingText?: string | null;
}

export interface EvidenceBoard {
  refs: EvidenceRef[];
  /** false = chưa có nguồn thật. UI hiện trạng thái unavailable, KHÔNG highlight. */
  available: boolean;
  /** Vì sao chưa có — để UI nói thẳng thay vì im lặng. */
  reason: string | null;
}

const EVIDENCE_UNAVAILABLE_REASON =
  "Chưa có nguồn trích dẫn thật (vị trí trong tin / công thức / chỉ số thị trường).";

/**
 * Dựng EvidenceRef từ tín hiệu backend — CHỈ VỚI NHỮNG TÍN HIỆU THẬT.
 *
 * `source: "missing"` không phải bằng chứng (nó là thông tin về sự thiếu), nên
 * không sinh ref cho nó.
 *
 * `location` = null khi backend chưa lưu span/index thật. Đây là khoảng trống
 * contract đã biết, KHÔNG phải chỗ để điền giả: cần `span` (start/end trong
 * `checks.original_text`) hoặc `market_statistic` mới mở được đúng chỗ.
 */
export function buildEvidenceBoard(input: EvidenceInput = {}): EvidenceBoard {
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const refs: EvidenceRef[] = [];

  signals.forEach((s, i) => {
    if (!isRecord(s) || s.source === "missing") return;
    const label = typeof s.signal === "string" ? s.signal.trim() : "";
    if (!label) return;
    refs.push({
      // id chỉ là khoá ổn định để React key + tra cứu, KHÔNG phải id của nguồn
      // ngoài. Vì chưa có hệ thống id thật, id này thuần nội bộ adapter sinh ra.
      id: `${s.source}-${i}`,
      type: s.source === "listing_text" ? "listing_text" : "calculated",
      label,
      source: s.source,
      excerpt: typeof s.detail === "string" && s.detail.trim() ? s.detail : null,
      // Chưa có span thật -> null. UI hiện "chưa định vị được", KHÔNG gắn
      // công thức giả làm vị trí.
      location: null,
    });
  });

  if (refs.length === 0) {
    return { refs: [], available: false, reason: EVIDENCE_UNAVAILABLE_REASON };
  }
  return { refs, available: true, reason: null };
}

// ------------------------------------------------------- price intelligence

export interface PriceDifferenceView {
  /** Giữ DẤU của backend. >0 = tin CAO hơn median, <0 = tin THẤP hơn median.
   *  Adapter không đảo dấu — chỉ sinh câu chữ cho con số đã có. */
  percent: number;
  known: true;
  direction: "above" | "below" | "equal";
  display: string;
}

/**
 * Câu chữ chênh lệch giá. Giữ nguyên quy ước backend (lib/price/types.ts):
 *   difference_percent > 0 -> giá tin CAO hơn trung vị
 *   difference_percent < 0 -> giá tin THẤP hơn trung vị
 * Không có median thì không có chênh lệch — trả null, UI không hiện số.
 */
export function buildPriceDifference(raw: unknown): PriceDifferenceView | null {
  const n = boundedNumber(raw, -1000, 1000);
  if (n === null) return null;
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 10) / 10;
  if (n > 0) {
    return {
      percent: n,
      known: true,
      direction: "above",
      display: `Cao hơn trung vị ${rounded}%`,
    };
  }
  if (n < 0) {
    return {
      percent: n,
      known: true,
      direction: "below",
      display: `Thấp hơn trung vị ${rounded}%`,
    };
  }
  return { percent: 0, known: true, direction: "equal", display: "Bằng trung vị" };
}

export interface PriceIntelligenceView {
  /** Có bộ số thống kê để hiện hay không (đã qua điều kiện sample size). */
  available: boolean;
  state: "locked" | "ready" | "not_enough_data" | "unavailable";
  sampleSize: number;
  trimmedSize: number;
  scopeLevel: string | null;
  scopeDescription: string | null;
  confidence: ConfidenceView;
  freshness: Freshness;
  /** null khi chưa đủ mẫu. KHÔNG bao giờ trả số thay cho median. */
  medianPpm2: number | null;
  p25Ppm2: number | null;
  p75Ppm2: number | null;
  minPpm2: number | null;
  maxPpm2: number | null;
  targetPpm2: number | null;
  difference: PriceDifferenceView | null;
  limitations: string[];
  message: string | null;
}

export interface PriceViewInput {
  state: "locked" | "ready" | "not_enough_data" | "unavailable";
  data?: PriceIntelligence | null;
  message?: string | null;
  nowMs?: number;
}

/**
 * Map Price Intelligence sang view model. Chỉ đọc field ĐÃ CÓ trong
 * lib/price/types.ts — KHÔNG dựng lại benchmark và KHÔNG tính thêm số nào.
 *
 * sample dưới ngưỡng -> median/p25/p75/min/max đều null (đã canShowStatistics
 * loại), nên UI không có gì để hiện số giả.
 */
export function buildPriceIntelligenceView(input: PriceViewInput): PriceIntelligenceView {
  const nowMs = input.nowMs;
  const base: PriceIntelligenceView = {
    available: false,
    state: input.state,
    sampleSize: 0,
    trimmedSize: 0,
    scopeLevel: null,
    scopeDescription: null,
    confidence: normalizeConfidence({}),
    freshness: "unknown",
    medianPpm2: null,
    p25Ppm2: null,
    p75Ppm2: null,
    minPpm2: null,
    maxPpm2: null,
    targetPpm2: null,
    difference: null,
    limitations: [],
    message: input.message ?? null,
  };

  if (input.state === "locked") {
    return { ...base, message: input.message ?? "Mở khóa phân tích giá tham chiếu" };
  }
  const d = input.data;
  if (input.state !== "ready" || !d) {
    return {
      ...base,
      message:
        input.message ??
        (input.state === "not_enough_data"
          ? "Chưa đủ dữ liệu tham chiếu cho khu vực này."
          : "Phân tích giá tham chiếu tạm thời chưa khả dụng."),
    };
  }

  const stats = canShowStatistics(d) ? d.statistics : null;
  return {
    available: stats !== null,
    state: "ready",
    sampleSize: d.sample_size,
    trimmedSize: d.trimmed_size,
    scopeLevel: d.scope_level ?? null,
    scopeDescription: d.scope?.scope_description ?? null,
    confidence: normalizeConfidence({ level: d.confidence }),
    freshness: nowMs === undefined ? normalizeFreshness(d.generated_at) : normalizeFreshness(d.generated_at, nowMs),
    medianPpm2: stats?.median_ppm2 ?? null,
    p25Ppm2: stats?.p25_ppm2 ?? null,
    p75Ppm2: stats?.p75_ppm2 ?? null,
    minPpm2: stats?.min_ppm2 ?? null,
    maxPpm2: stats?.max_ppm2 ?? null,
    targetPpm2: boundedNumber(d.target?.price_per_m2, 0, Number.MAX_SAFE_INTEGER),
    difference: buildPriceDifference(d.target?.difference_percent),
    limitations: Array.isArray(d.limitations) ? d.limitations.slice(0, 8) : [],
    message: null,
  };
}

// ------------------------------------------------------------------- images

export interface ReportImage {
  imageUrl: string;
  thumbnailUrl: string | null;
  source: string | null;
  order: number;
  rightsStatus: "granted" | "unknown";
  expiresAt: string | null;
}

export interface ImageBoard {
  state: ImageLoadState;
  items: ReportImage[];
}

/**
 * Backend chưa có hợp đồng ảnh (không có image_url/thumbnail_url/load_status/
 * rights). Contract tối thiểu đã định nghĩa ở ReportImage; tới khi có, luôn
 * trả images = [] và state "no_images" để UI hiện placeholder trung tính.
 * KHÔNG dùng ảnh AI, KHÔNG tự sinh URL.
 */
export function buildImageBoard(raw: unknown = []): ImageBoard {
  if (!Array.isArray(raw)) return { state: "no_images", items: [] };
  const items: ReportImage[] = [];
  for (const v of raw) {
    if (!isRecord(v)) continue;
    const imageUrl = typeof v.image_url === "string" ? v.image_url.trim() : "";
    if (!imageUrl) continue;
    items.push({
      imageUrl,
      thumbnailUrl: typeof v.thumbnail_url === "string" && v.thumbnail_url.trim() ? v.thumbnail_url : null,
      source: typeof v.source === "string" && v.source.trim() ? v.source : null,
      order: boundedNumber(v.order, 0, 10_000) ?? items.length,
      rightsStatus: v.rights === "granted" ? "granted" : "unknown",
      expiresAt: typeof v.expires_at === "string" && v.expires_at.trim() ? v.expires_at : null,
    });
  }
  if (items.length === 0) return { state: "no_images", items: [] };
  items.sort((a, b) => a.order - b.order);
  return { state: "image_available", items };
}

// --------------------------------------------------------------- view model

/** Dữ liệu thô của 1 check, đúng như các cột bảng `checks`. */
export interface CheckRecord {
  id?: string | null;
  score?: number | null;
  deal_type?: string | null;
  is_ngop?: number | null;
  confidence?: number | null;
  province?: string | null;
  price_billion?: number | null;
  area_m2?: number | null;
  bedrooms?: number | null;
  original_text?: string | null;
  listing_url?: string | null;
  created_at?: string | null;
}

export interface ReportViewModel {
  checkId: string | null;
  status: ReportStatus;
  /** Retry là CAPABILITY riêng, không suy từ việc status có phải "failed". */
  retry: { supported: boolean };
  score: Normalized<number>;
  dealType: DealTypeView;
  isNgop: Normalized<number>;
  confidence: ConfidenceView;
  freshness: Freshness;
  missingData: { field: string; display: string }[];
  evidence: EvidenceBoard;
  price: PriceIntelligenceView;
  images: ImageBoard;
  entitlement: Entitlement;
  /** Câu chữ đã sẵn sàng cho AI section, null = chưa có. */
  proSummary: { headline: string; text: string; confidence: ConfidenceView } | null;
  limitations: string[];
}

export interface ReportViewModelInput {
  check?: CheckRecord | null;
  proAnalysis?: ProAnalysis | null;
  price?: PriceViewInput | null;
  /** Tín hiệu backend đã ghi (Evidence Pack) để dựng evidence board. */
  evidenceSignals?: { signal: string; detail: string; source: EvidenceSource }[];
  images?: unknown;
  plan?: string | null;
  /** Trạng thái tải phía client. */
  loading?: boolean;
  analyzing?: boolean;
  failed?: boolean;
  listingUnavailable?: boolean;
  /**
   * Lỗi này có thương lượng lại được không. Mặc định FALSE — không có lý do để
   * coi mọi lỗi là retry được: 429 (hết lượt) thì retry chỉ tốn lượt, lỗi sở
   * hữu (403) thì retry vô nghĩa. Caller biết HTTP status nên tự trả lời.
   */
  retrySupported?: boolean;
  nowMs?: number;
}

function missingField(field: string, display: string): { field: string; display: string } {
  return { field, display };
}

/**
 * Hàm chính. Mọi thứ UI hiển thị về report đều phải đi qua đây.
 *
 * `partial` không phải trạng thái lỗi: report chạy được nhưng thiếu chấm điểm /
 * chưa phân loại / chưa có tham chiếu giá. Người dùng vẫn đọc được phần có.
 */
export function buildReportViewModel(input: ReportViewModelInput = {}): ReportViewModel {
  const check = input.check ?? null;
  const nowMs = input.nowMs;

  const score = normalizeScore(check?.score);
  const dealType = normalizeDealType(check?.deal_type);
  const isNgop = normalizeIsNgop(check?.is_ngop);
  const confidence = normalizeConfidence({ numeric: check?.confidence });

  const price = input.price
    ? buildPriceIntelligenceView(
        nowMs === undefined ? input.price : { ...input.price, nowMs },
      )
    : buildPriceIntelligenceView({ state: "unavailable" });

  const evidence = buildEvidenceBoard({
    signals: input.evidenceSignals,
    listingText: check?.original_text ?? null,
  });

  const missingData: { field: string; display: string }[] = [];
  if (!score.known) missingData.push(missingField("score", score.display));
  if (!dealType.known) missingData.push(missingField("deal_type", dealType.display));
  if (!isNgop.known) missingData.push(missingField("is_ngop", isNgop.display));
  if (price.state === "not_enough_data") {
    missingData.push(missingField("price_reference", price.message ?? "Chưa đủ dữ liệu tham chiếu"));
  }
  if (!evidence.available) {
    missingData.push(missingField("evidence", EVIDENCE_UNAVAILABLE_REASON));
  }

  const hasPro = !!input.proAnalysis;
  const incomplete = !score.known || !hasPro || !price.available;

  // Retry là capability riêng, KHÔNG suy ra từ status "failed": 429 hết lượt
  // hoặc 403 sai sở hữu thì retry chỉ tốn công. Caller biết HTTP status nên tự trả lời.
  const retrySupported = input.retrySupported === true;

  const freshness = nowMs === undefined
    ? normalizeFreshness(input.proAnalysis ? undefined : check?.created_at)
    : normalizeFreshness(check?.created_at, nowMs);

  return {
    checkId: check?.id ?? null,
    status: normalizeReportStatus({
      loading: input.loading,
      analyzing: input.analyzing,
      failed: input.failed,
      listingUnavailable: input.listingUnavailable,
      incomplete,
    }),
    retry: { supported: retrySupported },
    score,
    dealType,
    isNgop,
    confidence,
    freshness,
    missingData,
    evidence,
    price,
    images: buildImageBoard(input.images),
    entitlement: buildEntitlement({ plan: input.plan }),
    proSummary: input.proAnalysis
      ? {
          headline: input.proAnalysis.summary.headline,
          text: input.proAnalysis.summary.text,
          // Pro đã có mức low|medium|high; numeric chỉ để giữ số gốc cùng nhau.
          confidence: normalizeConfidence({ level: input.proAnalysis.summary.confidence }),
        }
      : null,
    limitations: input.proAnalysis?.limitations ?? price.limitations ?? [],
  };
}
