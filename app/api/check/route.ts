import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { callJev } from "@/lib/ai/jev-check";
import { adminClient } from "@/lib/admin";
import {
  handleCheck,
  corsHeaders,
  getQuota,
  type CheckDeps,
} from "@/lib/check-route";

// API check 1 tin BĐS qua Jev. Key chỉ nằm ở server, không bao giờ lộ ra client.
// Cần đăng nhập (session Supabase) + có quota trong ngày.
export const runtime = "nodejs";
// Jev đôi khi chậm 20-40s; Hobby cho tối đa 300s nên để 60s cho chắc
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// GET: quota hôm nay để Bulk Check biết còn bao nhiêu lượt
export async function GET(req: NextRequest) {
  const CORS = corsHeaders(req);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401, headers: CORS });
  }

  return NextResponse.json(await getQuota(supabase, user.id), { headers: CORS });
}

// Next 15.5 kiểm tra kiểu (a) tham số thứ 2 của route handler phải KHỚP
// RouteContext ({ params: Promise<...> }) và (b) phải NHẬN được context đó.
// Nên tham số thứ 2 ở đây là superset: deps (tùy chọn) + params bắt buộc.
// Test bơm deps qua đúng tham số này; `asCheckDeps` phân biệt 2 nghĩa ở runtime.
type CheckRouteArg = Partial<CheckDeps> & { params: Promise<unknown> };

// Chỉ nhận deps từ test. Next.js luôn truyền context route (params Promise)
// làm tham số thứ 2 — nếu bỏ qua điều đó, context sẽ bị coi là deps và
// `deps.createSupabaseClient` sẽ undefined -> mọi request check đều lỗi.
function asCheckDeps(value: unknown): CheckDeps | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CheckDeps>;
  if (
    typeof v.createSupabaseClient !== "function" ||
    typeof v.rateLimit !== "function" ||
    typeof v.callJev !== "function" ||
    typeof v.adminClient !== "function"
  ) {
    return null;
  }
  return value as CheckDeps;
}

export async function POST(req: NextRequest, deps: CheckRouteArg) {
  return handleCheck(
    req,
    asCheckDeps(deps) ?? {
      createSupabaseClient: createClient,
      rateLimit: checkRateLimit,
      callJev,
      adminClient,
    },
  );
}
