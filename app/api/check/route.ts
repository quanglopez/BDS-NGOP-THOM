import { NextRequest, NextResponse } from "next/server";

// API check 1 tin BĐS qua Jev. Key chỉ nằm ở server, không bao giờ lộ ra client.
export const runtime = "nodejs";
export const maxDuration = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Bộ câu hỏi chấm điểm 1 tin BĐS Vũng Tàu
const QUESTIONS = {
  investment_potential: {
    type: "score",
    instructions: "Chấm điểm tiềm năng đầu tư BĐS Vũng Tàu",
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text: string = body?.text ?? "";

    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Tin BĐS quá ngắn" }, { status: 400, headers: CORS });
    }

    const JEV_KEY = process.env.JEV_API_KEY;
    if (!JEV_KEY) {
      return NextResponse.json(
        { error: "Chưa cấu hình JEV_API_KEY trên Vercel" },
        { status: 500, headers: CORS },
      );
    }

    const jevRes = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JEV_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: text.slice(0, 6000),
        questions: QUESTIONS,
      }),
    });

    const raw = await jevRes.text();
    if (!jevRes.ok) {
      return NextResponse.json(
        { error: "Jev lỗi", detail: raw.slice(0, 500) },
        { status: jevRes.status, headers: CORS },
      );
    }

    const data = JSON.parse(raw);
    const ans = data.answers || data;

    // Điểm 0-4 của score type quy về thang 100
    const invest = ans.investment_potential?.score ?? 0;
    const invest100 = invest <= 4 ? Math.round((invest / 4) * 100) : Math.round(invest);

    return NextResponse.json(
      {
        investment_score: invest100,
        deal_type: ans.deal_type?.choice || "binh_thuong",
        confidence: ans.deal_type?.confidence || 0.7,
        is_ngop: Math.round((ans.is_ngop?.noul ?? 0) * 100),
        legal_safety: Math.round((ans.legal_safety?.noul ?? 0) * 100),
        location_growth: ans.location_growth?.score ?? 0,
        liquidity: ans.liquidity?.score ?? 0,
        raw: data,
      },
      { headers: CORS },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}
