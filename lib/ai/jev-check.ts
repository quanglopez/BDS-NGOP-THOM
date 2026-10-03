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
