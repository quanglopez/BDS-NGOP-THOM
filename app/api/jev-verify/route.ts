import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { askProRoute, type ProFailureState } from "@/lib/ai/jev-decision";
import { askAgentNextAction, type AgentDecisionState } from "@/lib/ai/jev-agent-decide";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * KIỂM CHỨNG JEV — endpoint TẠM THỜI, chỉ dùng lúc verify.
 *
 * Mục đích: chạy một live call thật tới Jev mà KHÔNG cần lộ API key ra máy
 * dev. Key nằm trong env Vercel, chỉ server đọc được.
 *
 * AN TOÀN:
 *  - Yêu cầu đăng nhập + email nằm trong ADMIN_EMAILS (giống /api/admin).
 *  - Rate limit theo IP.
 *  - KHÔNG BAO GIỜ trả về key.
 *  - Không ghi DB, không đụng dữ liệu người dùng.
 *
 * XOÁ endpoint này sau khi verify xong (xem README_JEV.md).
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rate = await checkRateLimit(ip, 5, "jev-verify");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều lần gọi. Thử lại sau ít phút." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  if (!isAdmin(user.email)) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    contract?: string;
    state?: ProFailureState | AgentDecisionState;
  };

  const rawKey = process.env.JEV_API_KEY ?? "";
  const keyStatus = !rawKey ? "missing" : rawKey.toLowerCase().startsWith("dummy") ? "placeholder" : "present";
  // KHÔNG log key. Chỉ báo trạng thái.
  console.log(`[jev-verify] contract=${body.contract ?? "?"} key=${keyStatus} mode=live ip=${ip}`);

  if (body.contract === "agent-next-action") {
    const receipt = await askAgentNextAction(body.state as AgentDecisionState, { mode: "live" });
    return NextResponse.json({ key_status: keyStatus, receipt });
  }

  // Mặc định: contract pro-analysis-route
  const receipt = await askProRoute(
    (body.state ?? {
      attempt: 2,
      modelIndex: 0,
      model: "qwen/qwen3.8-27b:free",
      failure: "guard_failed",
      priorModels: ["qwen/qwen3.8-27b:free"],
      priorFailures: ["guard_failed"],
      guardReasons: ['claim đã xác minh không có nguồn: "pháp lý đã được xác minh"'],
      modelsRemaining: 1,
    }) as ProFailureState,
    { JEV_DECISION: "on" },
  );
  return NextResponse.json({ key_status: keyStatus, receipt });
}
