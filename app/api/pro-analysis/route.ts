import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { effectivePlan, planAllowsProAnalysis } from "@/lib/quota";
import { buildEvidencePack } from "@/lib/ai/evidence";
import {
  formatProAnalysisMetrics,
  generateProAnalysis,
  PRO_ANALYSIS_VERSION_FALLBACK,
} from "@/lib/ai/pro-analysis";
import { buildSnapshotUpdate, isFreshSnapshot, shouldPersistSnapshot } from "@/lib/ai/report-cache";
import { analyzeListing, SCORING_CODE_VERSION } from "@/lib/scoring";
import { parseScoringSnapshot, resultFromSnapshot } from "@/lib/score-snapshot";

export const runtime = "nodejs";
// Tách budget riêng khỏi /api/check: OpenRouter timeout 25s, còn dư cho DB + validate
export const maxDuration = 60;

const ALLOWED_ORIGINS = new Set([
  "https://checkbds.online",
  "http://checkbds.online",
  "https://check-bds-ngop.vercel.app",
  "https://check-bds-ngop-quangs-projects-cc2709cd.vercel.app",
  "http://localhost:3000",
]);

// Log phải an toàn: không API key, không email, không SĐT.
function sanitizeForLog(msg: string): string {
  return msg
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted_key]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[redacted_email]")
    .replace(/\b\d{9,11}\b/g, "[redacted_digits]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

// Cột numeric của Supabase có thể trả về string — ép về number, thiếu thì null.
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function corsHeaders(req: Request): Record<string, string> {  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// Phân tích Pro nâng cao cho 1 lần check đã lưu.
// Enforce server-side: auth -> ownership -> plan Pro. Free KHÔNG bao giờ chạm OpenRouter.
export async function POST(req: NextRequest) {
  const CORS = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401, headers: CORS });
  }

  const body = await req.json().catch(() => ({}));
  const checkId = typeof body?.checkId === "string" ? body.checkId : "";
  if (!checkId) {
    return NextResponse.json({ error: "Thiếu checkId" }, { status: 400, headers: CORS });
  }

  // Ownership: chỉ chủ report mới đọc/generate (UUID chống đoán ID tuần tự)
  const { data: row, error: rowError } = await supabase
    .from("checks")
    .select(
      "id, user_id, original_text, score, deal_type, province, price_billion, area_m2, bedrooms, listing_url, analysis_json, analysis_version, scoring_version, ai_model, ai_generated_at, scoring_snapshot, scoring_code_version, jev_is_ngop, jev_legal_safety, jev_location_growth, jev_liquidity",
    )
    .eq("id", checkId)
    .maybeSingle();

  if (rowError || !row) {
    return NextResponse.json({ error: "Không tìm thấy báo cáo" }, { status: 404, headers: CORS });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403, headers: CORS });
  }

  // Plan gate server-side: Free dừng ở đây, chưa hề gọi OpenRouter
  const { data: profile } = await supabase
    .from("users")
    .select("plan, plan_expires_at")
    .eq("id", user.id)
    .single();
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);
  if (!planAllowsProAnalysis(plan)) {
    return NextResponse.json(
      { error: "locked", message: "Mở khóa phân tích Pro", requiredPlan: "pro" },
      { status: 403, headers: CORS },
    );
  }

  const currentVersion = process.env.PRO_ANALYSIS_VERSION || PRO_ANALYSIS_VERSION_FALLBACK;
  // Version scoring đi cùng CODE chấm điểm (lib/scoring.ts), không đọc từ env.
  const scoringVersion = SCORING_CODE_VERSION;

  // Cache: đã có snapshot đúng version -> trả luôn, KHÔNG gọi model nào nữa.
  // Không so sánh ai_model: report là snapshot, không "nâng cấp" lại bằng model primary.
  const cacheHit = isFreshSnapshot(row, currentVersion);

  // DEBUG TẠM (xem sau khi xác nhận): soi đúng cache flow + kết quả lưu.
  console.log(
    `[pro-analysis-cache] check_id=${checkId} ` +
      `has_analysis_json=${row.analysis_json ? "true" : "false"} ` +
      `analysis_version=${row.analysis_version ?? "-"} current_version=${currentVersion} ` +
      `cache_hit=${cacheHit} ai_generate=${cacheHit ? "false" : "true"} ` +
      `stored_ai_model=${row.ai_model ?? "-"} scoring_source_pending=true`,
  );

  if (cacheHit) {
    return NextResponse.json(
      {
        ok: true,
        cached: true,
        analysis: row.analysis_json,
        analysis_version: row.analysis_version,
        ai_model: row.ai_model ?? null,
        ai_generated_at: row.ai_generated_at ?? null,
      },
      { headers: CORS },
    );
  }

  // Build evidence từ dữ liệu thật. Thứ tự nguồn scoring (KHÔNG reverse):
  //   1. checks.scoring_snapshot — đúng số lúc user check (check mới)
  //   2. checks.jev_*            — merge sub-score Jev vào kết quả local
  //   3. analyzeListing(text)    — check cũ, tái dựng, đánh dấu legacy_generated
  // LƯU Ý riêng tư: không đưa phone/contact_name vào evidence gửi cho AI.
  const local = analyzeListing(row.original_text ?? "");
  const price =
    typeof row.price_billion === "number" && row.price_billion > 0 ? row.price_billion * 1e9 : null;
  const area = typeof row.area_m2 === "number" && row.area_m2 > 0 ? row.area_m2 : null;
  const bedrooms =
    typeof row.bedrooms === "number" && row.bedrooms > 0 ? Math.floor(row.bedrooms) : null;
  const title = (row.original_text ?? "").split("\n")[0]?.slice(0, 200) || null;

  const snapshot = parseScoringSnapshot(row.scoring_snapshot);
  const jev = {
    is_ngop: numOrNull(row.jev_is_ngop),
    legal_safety: numOrNull(row.jev_legal_safety),
    location_growth: numOrNull(row.jev_location_growth),
    liquidity: numOrNull(row.jev_liquidity),
  };

  // Nguồn scoring: snapshot > jev_* > local. dealType/overall/score_explanation
  // đều lấy theo đúng nguồn đó để không lệch với breakdown đã hiển thị.
  const scoringResult = snapshot ? resultFromSnapshot(snapshot) : local;
  const dealType = snapshot ? snapshot.deal_type : (row.deal_type ?? "binh_thuong");
  const localScore = typeof row.score === "number" ? row.score : scoringResult.overall;

  const evidence = buildEvidencePack({
    title,
    price,
    area,
    bedrooms,
    ward: null,
    region: row.province,
    listingUrl: row.listing_url,
    listingText: row.original_text,
    result: scoringResult,
    dealType,
    scoringVersion,
    analysisVersion: currentVersion,
    snapshot,
    jev: snapshot ? null : jev,
  });
  // Overall lấy đúng điểm đã lưu (Jev), không tính lại
  evidence.scoring.overall_score = localScore;

  // Model chain bên trong luôn trả về (kể cả khi cả chain fail) -> không bao giờ 500
  // vì lý do AI. 429/rate-limit là trạng thái bình thường của model :free.
  const outcome = await generateProAnalysis(evidence);

  // Chỉ save khi là kết quả AI thật. Fallback deterministic tính lại miễn phí
  // nên không persist — lần mở sau sẽ tự thử generate lại.
  // Dùng service role vì bảng checks không có update policy cho user.
  // ai_model = model THỰC TẾ đã sinh ra report (có thể là model fallback).
  //
  // QUAN TRỌNG: lỗi lưu KHÔNG được làm hỏng response. Nếu adminClient() throw
  // (thiếu SUPABASE_SERVICE_ROLE_KEY) hoặc update fail, người dùng vẫn phải thấy
  // report — chỉ mất cache. Trước đây throw ở đây làm 500 và khiến F5 regenerate
  // mỗi lần.
  let savedAnalysis = false;
  const persistModel = outcome.model;
  if (shouldPersistSnapshot(outcome) && persistModel) {
    try {
      const { error: saveError } = await adminClient()
        .from("checks")
        .update(
          buildSnapshotUpdate({
            analysis: outcome.analysis,
            actualModel: persistModel,
            analysisVersion: currentVersion,
            scoringVersion,
          }),
        )
        .eq("id", checkId);
      if (saveError) {
        console.error(
          `[pro-analysis-error] provider_error=save_failed check_id=${checkId} ` +
            `requested_model=${outcome.requestedModel} actual_model=${outcome.model} ` +
            `response_body_safe=${sanitizeForLog(saveError.message)}`,
        );
      } else {
        savedAnalysis = true;
      }
    } catch (e) {
      console.error(
        `[pro-analysis-error] provider_error=save_threw check_id=${checkId} ` +
          `requested_model=${outcome.requestedModel} actual_model=${outcome.model} ` +
          `response_body_safe=${sanitizeForLog(e instanceof Error ? e.message : "unknown")}`,
      );
    }
  }

  console.log(
    `[pro-analysis-cache] check_id=${checkId} has_analysis_json=true ` +
      `analysis_version=${currentVersion} current_version=${currentVersion} ` +
      `cache_hit=false ai_generate=true saved_analysis=${savedAnalysis} ` +
      `ai_model=${outcome.model ?? "-"} from_fallback=${outcome.fromFallback}`,
  );

  console.log(
    `[pro-analysis:${requestId}] check=${checkId} plan=${plan} cached=false ` +
      `reason=${outcome.fallbackReason ?? "-"} saved_analysis=${savedAnalysis} ` +
      `${formatProAnalysisMetrics(outcome.metrics)}`,
  );

  return NextResponse.json(
    {
      ok: true,
      cached: false,
      fromFallback: outcome.fromFallback,
      analysis: outcome.analysis,
      analysis_version: currentVersion,
      // Frontend không cần biết model nào đã trả lời; vẫn trả về để admin/đo lường.
      ai_model: outcome.model,
    },
    { headers: CORS },
  );
}
