// JSON Schema cho structured output (response_format: json_schema).
// Chỉ dùng cho model đã audit là hỗ trợ structured output (xem model-chain.ts).
// Schema là ràng buộc HÌNH DẠNG — KHÔNG phải ràng buộc nội dung. Mọi giá trị số/claim
// vẫn phải qua local validation (schema.ts) + hallucination guard (guard.ts).
//
// strict:false để provider không từ chối schema khi model lệch nhẹ; nếu provider
// từ chối param, tầng chain hạ xuống prompt-only + parse thay vì sập cả chain.

const nonEmptyString = { type: "string" } as const;

export const PRO_ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "highlights",
    "score_explanation",
    "factor_analysis",
    "price_analysis",
    "warnings",
    "next_steps",
    "limitations",
  ],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "text", "confidence"],
      properties: {
        headline: { type: "string", maxLength: 200 },
        text: { type: "string", maxLength: 2000 },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
    highlights: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "explanation", "evidence_source"],
        properties: {
          type: { type: "string", enum: ["positive", "neutral", "warning"] },
          title: { type: "string", maxLength: 200 },
          explanation: { type: "string", maxLength: 1200 },
          evidence_source: nonEmptyString,
        },
      },
    },
    score_explanation: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "strengths", "weaknesses"],
      properties: {
        summary: { type: "string", maxLength: 1000 },
        strengths: { $ref: "#/$defs/swList" },
        weaknesses: { $ref: "#/$defs/swList" },
      },
    },
    factor_analysis: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factor", "score", "label", "explanation", "evidence_source"],
        properties: {
          factor: { type: "string", maxLength: 120 },
          score: { type: "integer", minimum: 0, maximum: 100 },
          label: { type: "string", maxLength: 120 },
          explanation: { type: "string", maxLength: 1200 },
          evidence_source: nonEmptyString,
        },
      },
    },
    price_analysis: {
      type: "object",
      additionalProperties: false,
      required: [
        "available",
        "asking_price",
        "price_per_m2",
        "reference_available",
        "reference_median",
        "difference_percent",
        "explanation",
      ],
      properties: {
        available: { type: "boolean" },
        asking_price: { type: ["number", "null"] },
        price_per_m2: { type: ["number", "null"] },
        reference_available: { type: "boolean" },
        reference_median: { type: ["number", "null"] },
        difference_percent: { type: ["number", "null"] },
        explanation: { type: "string", maxLength: 1200 },
      },
    },
    warnings: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "explanation", "requires_verification", "evidence_source"],
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string", maxLength: 200 },
          explanation: { type: "string", maxLength: 1200 },
          requires_verification: { type: "boolean" },
          evidence_source: nonEmptyString,
        },
      },
    },
    next_steps: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "title", "reason"],
        properties: {
          priority: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string", maxLength: 200 },
          reason: { type: "string", maxLength: 1200 },
        },
      },
    },
    limitations: { type: "array", maxItems: 8, items: { type: "string" } },
  },
  $defs: {
    swList: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "explanation", "evidence_source"],
        properties: {
          title: { type: "string", maxLength: 200 },
          explanation: { type: "string", maxLength: 1200 },
          evidence_source: nonEmptyString,
        },
      },
    },
  },
};

export const PRO_ANALYSIS_JSON_SCHEMA_NAME = "pro_analysis";
