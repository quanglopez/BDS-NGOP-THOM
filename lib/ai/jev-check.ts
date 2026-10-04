// Jev provider dùng chung cho Check thủ công (/api/check) và Auto-Enrichment worker.
// Tách khỏi route để hai luồng dùng CÙNG bộ câu hỏi + cùng cách gọi — không có
// pipeline AI song song. Key chỉ nằm ở server, không bao giờ lộ ra client.

// Shape 1 câu trả lời từ Jev
export type JevAnswer = {
  score?: number;
  noul?: number;
  choice?: string;
  confidence?: number;
};

// Bộ câu hỏi chấm điểm 1 tin BĐS Việt Nam
export const CHECK_QUESTIONS = {
  investment_potential: {
    type: "score",
    instructions: "Chấm điểm tiềm năng đầu tư BĐS Việt Nam",
    criteria: ["Rất tệ", "Thấp", "Trung bình", "Cao", "Rất cao kèo thơm"],
  },
  is_ngop: {
    type: "noul",
    instructions: "Có phải bán gấp ngộp bank thanh lý cần tiền gấp không?",
  },
  legal_safety: {
    type: "noul",
    instructions: "Pháp lý có an toàn không? sổ hồng riêng không tranh chấp?",
  },
  location_growth: {
    type: "score",
    instructions: "Vị trí tiềm năng tăng giá?",
    criteria: ["Xa trung tâm", "Trung bình", "Khá", "Tốt gần biển trung tâm", "Rất tốt mặt tiền biển Thùy Vân Trần Phú"],
  },
  liquidity: {
    type: "score",
    instructions: "Thanh khoản dễ bán lại?",
    criteria: ["Rất khó bán", "Khó", "Trung bình", "Dễ", "Rất dễ bán lại"],
  },
  deal_type: {
    type: "choice",
    instructions: "Phân loại kèo BĐS",
    criteria: {
      ngop_ngon: "Kèo ngộp ngân hàng giá rẻ hơn thị trường 15%+ - nên mua nhanh",
      thom_dau_tu: "Kèo thơm đầu tư tốt giá hợp lý vị trí đẹp",
      gia_cao: "Giá cao hơn thị trường",
      rui_ro_phap_ly: "Rủi ro pháp lý quy hoạch tranh chấp",
      binh_thuong: "Tin bình thường",
    },
  },
} as const;

/** Chuẩn hoá score type của Jev về thang 100. Trả null khi giá trị không phải số.
 *  Chuỗi số ("3") được coerce để giữ đúng behavior trước khi tách hàm:
 *  JS tự ép khi so sánh nên "3" từng ra 75, không phải 0. */
export function investmentScore100(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return n <= 4 ? Math.round((n / 4) * 100) : Math.round(n);
}

/** Deal type hợp lệ — chốt với `criteria` của CHECK_QUESTIONS.deal_type.
 *  Nguồn DUY NHẤT: /api/check và Auto-Enrichment cùng dùng danh sách này. */
export const DEAL_TYPES = new Set([
  "ngop_ngon",
  "thom_dau_tu",
  "gia_cao",
  "rui_ro_phap_ly",
  "binh_thuong",
]);

/** Phân loại kèo từ provider. Trả null khi provider KHÔNG trả classification hợp
 *  lệ — KHÔNG quy về "binh_thuong". "Chưa ai phân loại" và "bình thường" là hai
 *  kết luận khác nhau; gộp chúng làm tin không phân loại trông như tin an toàn. */
export function normalizeDealType(value: unknown): string | null {
  return typeof value === "string" && DEAL_TYPES.has(value) ? value : null;
}

/** Noul của Jev (0..1) -> thang 100. null = provider không trả noul.
 *  0 là giá trị THẬT và phải giữ nguyên 0, không phải null. */
export function noulPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Noul của câu is_ngop. Tách riêng khỏi noulPercent() để tên gọi đúng ý nghĩa
 *  tại call-site: "ngộp" là kết luận, thiếu noul là chưa biết. */
export function ngopPercent(value: unknown): number | null {
  return noulPercent(value);
}

/** Score 0..4 của Jev -> thang 100 (0..4 nhân 25). null = provider không trả.
 *  Giữ đúng quy tắc cũ: số >4 coi như đã ở thang 100 rồi. */
export function score0to4ToHundred(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value <= 4 ? Math.round((value / 4) * 100) : Math.round(value);
}

/** Số thực sự có, ngược lại null. Không có default 0/0.7 — số mặc định là dữ
 *  liệu bịa, và 0/0.7 đều mang nghĩa riêng cho người đọc report. */
export function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Điểm investment cho luồng Check thủ công. Trả null khi Jev trả score hỏng —
 *  KHÔNG bao giờ quy về 0: 0 là điểm thật và sẽ được persist thành Radar signal. */
export function manualInvestmentScore(raw: unknown): number | null {
  return investmentScore100(raw);
}

/** Quyết định của /api/check cho score thủ công: hoặc trả điểm hợp lệ, hoặc
 *  báo `invalid` để route trả 502. KHÔNG bao giờ `ok` với score giả. */
export function decideManualInvestment(raw: unknown): { ok: true; score: number } | { ok: false } {
  const score = investmentScore100(raw);
  return score == null ? { ok: false } : { ok: true, score };
}

/** Kiểm tra phần trả lời Jev cho luồng Check. Trả lỗi rõ ràng để route map vào
 *  502 thay vì persistence score giả. Giữ deal_type fallback / is_ngop rounding
 *  ngoài phạm vi hàm này. */
export function checkInvestmentVerdict(ans: { investment_potential?: { score?: unknown } }): { ok: true; score: number } | { ok: false } {
  return decideManualInvestment(ans.investment_potential?.score);
}

// Gọi Jev 1 lần với timeout riêng (tránh treo hết maxDuration mà không rõ lý do)
export async function callJevOnce(key: string, body: unknown, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Gọi Jev tối đa 2 lần: retry khi timeout/mạng sập/lỗi 5xx.
// Lỗi 4xx là do request sai nên không retry.
export async function callJev(key: string, body: unknown, requestId: string, logPrefix: string) {
  const TIMEOUT_MS = 25000;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await callJevOnce(key, body, TIMEOUT_MS);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = `status=${res.status} body=${(await res.text()).slice(0, 300)}`;
      console.warn(`[check:${requestId}] JEV_RETRY attempt=${attempt} ${lastError} ${logPrefix}`);
    } catch (e) {
      lastError = e instanceof Error ? e.name : "fetch_error";
      console.warn(`[check:${requestId}] JEV_RETRY attempt=${attempt} error=${lastError} ${logPrefix}`);
    }
  }
  throw new Error(`Jev không phản hồi sau 2 lần thử (${lastError})`);
}
