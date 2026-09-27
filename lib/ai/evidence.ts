// Evidence Pack: object chuẩn duy nhất được phép gửi cho AI.
// CHỈ chứa field thực sự có dữ liệu. Không tạo fake values để fill JSON.

import { scoreContributions, type ScoreContribution } from "../score-explain";
import { applyJevSubScores, type JevSubScores } from "../scoring";
import type { ScoringSnapshot } from "../score-snapshot";
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

// Nguồn của phần scoring trong Evidence Pack. Đưa vào pack để AI không
// tưởng mọi thứ đều là snapshot chính xác.
export type EvidenceScoringSource = "snapshot" | "jev_fields" | "legacy_text";

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
    // "snapshot" = đúng số lúc check; "jev_fields"/"legacy_text" = dữ liệu cũ,
    // tái dựng lại nên có thể lệch với thời điểm check.
    scoring_source: EvidenceScoringSource;
    legacy_generated: boolean;
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
  // Kết quả scoring tại thời điểm check (đã merge Jev)
  result: AnalysisResult;
  dealType: string;
  scoringVersion: string;
  analysisVersion: string;
  // Tầng ưu tiên cao nhất: snapshot đầy đủ lúc check (check mới)
  snapshot?: ScoringSnapshot | null;
  // Tầng 2: sub-score Jev đã persist riêng (check có jev_* nhưng chưa có snapshot)
  jev?: JevSubScores | null;
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
  const text = (input.listingText ?? "").toLowerCase();
  const price = input.price ?? null;
  const area = input.area ?? null;

  // Thứ tự ưu tiên (KHÔNG reverse):
  //   1. scoring_snapshot  — đúng số lúc check
  //   2. jev_* persisted   — merge sub-score Jev vào kết quả local
  //   3. analyzeListing()  — check cũ không có gì, tái dựng từ original_text
  let result: AnalysisResult = input.result;
  let scoringSource: EvidenceScoringSource = "legacy_text";
  let contributions: Pick<ScoreContribution, "label" | "delta" | "note">[];

  const snap = input.snapshot ?? null;
  if (snap) {
    result = {
      overall: snap.overall_score,
      tag: snap.tag,
      tagColor: snap.tag_color,
      breakdown: snap.breakdown,
      reasoning: snap.reasoning,
      action: snap.action,
      actionType: snap.action_type,
      extracted: input.result.extracted,
    };
    scoringSource = "snapshot";
    contributions = snap.score_contributions.map((c) => ({ label: c.label, delta: c.delta, note: c.note }));
  } else {
    const hasJev =
      !!input.jev &&
      [input.jev.is_ngop, input.jev.legal_safety, input.jev.location_growth, input.jev.liquidity].some(
        (v) => typeof v === "number",
      );
    if (hasJev) {
      result = applyJevSubScores(result, input.jev!);
      scoringSource = "jev_fields";
    }
    contributions = scoreContributions(result).map((c) => ({ label: c.label, delta: c.delta, note: c.note }));
  }

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
  for (const c of contributions) {
    if (c.delta <= -5 && redFlags.length < 10) {
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
      contributions,
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
      scoring_source: scoringSource,
      legacy_generated: scoringSource !== "snapshot",
    },
  };
}
