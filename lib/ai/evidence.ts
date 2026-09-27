// Evidence Pack: object chuẩn duy nhất được phép gửi cho AI.
// CHỈ chứa field thực sự có dữ liệu. Không tạo fake values để fill JSON.

import { scoreContributions } from "../score-explain";
import type { AnalysisResult } from "../types";

export interface EvidenceProperty {
  title: string | null;
  price: number | null;
  area: number | null;
  price_per_m2: number | null;
  bedrooms: number | null;
  ward: string | null;
  region: string | null;
  listing_url: string | null;
}

export interface EvidenceSignal {
  signal: string;
  detail: string;
  source: "listing_text" | "calculated" | "missing";
}

export interface EvidencePack {
  property: EvidenceProperty;
  scoring: {
    overall_score: number;
    deal_type: string;
    contributions: { label: string; delta: number; note: string }[];
    reasoning: string;
    action: string;
  };
  detected_signals: {
    red_flags: EvidenceSignal[];
    missing_fields: EvidenceSignal[];
  };
  price_intelligence: {
    available: false;
    sample_size: null;
    median_asking_price_per_m2: null;
    difference_percent: null;
    comparables: [];
  };
  metadata: {
    scoring_version: string;
    analysis_version: string;
  };
}

export interface EvidenceInput {
  // Dữ liệu thật từ tin/listing
  title?: string | null;
  price?: number | null;
  area?: number | null;
  bedrooms?: number | null;
  ward?: string | null;
  region?: string | null;
  listingUrl?: string | null;
  listingText?: string | null;
  // Kết quả scoring hiện tại (không tính lại)
  result: AnalysisResult;
  dealType: string;
  scoringVersion: string;
  analysisVersion: string;
}

// Backend tự tính price/m² — không để AI tính. Thiếu price/area -> null.
export function calcPricePerM2(price: number | null, area: number | null): number | null {
  if (price === null || area === null) return null;
  if (!(price > 0) || !(area > 0)) return null;
  return Math.round(price / area);
}

const RISK_KEYWORDS: { key: string; signal: string }[] = [
  { key: "tranh chấp", signal: "tranh chấp" },
  { key: "quy hoạch treo", signal: "quy hoạch treo" },
  { key: "ngập", signal: "ngập" },
  { key: "hẻm nhỏ", signal: "hẻm nhỏ" },
  { key: "giấy tay", signal: "giấy tay" },
  { key: "vi bằng", signal: "vi bằng" },
  { key: "không sổ", signal: "không sổ" },
  { key: "sổ chung", signal: "sổ chung" },
];

export function buildEvidencePack(input: EvidenceInput): EvidencePack {
  const { result } = input;
  const text = (input.listingText ?? "").toLowerCase();
  const price = input.price ?? null;
  const area = input.area ?? null;

  const redFlags: EvidenceSignal[] = [];
  for (const { key, signal } of RISK_KEYWORDS) {
    if (text.includes(key)) {
      redFlags.push({
        signal,
        detail: `Nội dung tin có đề cập "${key}" — tín hiệu phát hiện từ text, chưa được xác minh.`,
        source: "listing_text",
      });
    }
  }
  // Tín hiệu rủi ro từ scoring (điểm thành phần thấp) — ghi rõ là tính toán
  for (const c of scoreContributions(result)) {
    if (c.kind === "minus" && c.delta <= -5 && redFlags.length < 10) {
      redFlags.push({ signal: c.label, detail: c.note, source: "calculated" });
    }
  }

  const missing: EvidenceSignal[] = [];
  if (price === null) {
    missing.push({ signal: "thiếu giá", detail: "Tin không ghi giá chào bán.", source: "missing" });
  }
  if (area === null) {
    missing.push({ signal: "thiếu diện tích", detail: "Tin không ghi diện tích.", source: "missing" });
  }
  if ((input.bedrooms ?? null) === null) {
    missing.push({ signal: "thiếu số phòng ngủ", detail: "Tin không ghi số phòng ngủ.", source: "missing" });
  }
  if (!input.region) {
    missing.push({ signal: "thiếu khu vực", detail: "Không xác định được tỉnh/thành từ tin.", source: "missing" });
  }

  return {
    property: {
      title: input.title ?? null,
      price,
      area,
      price_per_m2: calcPricePerM2(price, area),
      bedrooms: input.bedrooms ?? null,
      ward: input.ward ?? null,
      region: input.region ?? null,
      listing_url: input.listingUrl ?? null,
    },
    scoring: {
      overall_score: result.overall,
      deal_type: input.dealType,
      contributions: scoreContributions(result).map((c) => ({
        label: c.label,
        delta: c.delta,
        note: c.note,
      })),
      reasoning: result.reasoning,
      action: result.action,
    },
    detected_signals: { red_flags: redFlags, missing_fields: missing },
    // Phase này chưa có dữ liệu tham chiếu — ghi rõ unavailable, KHÔNG bịa median
    price_intelligence: {
      available: false,
      sample_size: null,
      median_asking_price_per_m2: null,
      difference_percent: null,
      comparables: [],
    },
    metadata: {
      scoring_version: input.scoringVersion,
      analysis_version: input.analysisVersion,
    },
  };
}
