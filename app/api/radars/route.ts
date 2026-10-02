import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { getRadarAreas, listRadars } from "@/lib/radar/data";
import { validateRadarInput } from "@/lib/radar/criteria";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** Session client: `radars` đọc/ghi theo RLS (chỉ dòng của chính user). */
async function auth(): Promise<{ s: SupabaseClient; user: User } | null> {
  const s = await createClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  return user ? { s, user } : null;
}

export async function GET() {
  const authed = await auth();
  if (!authed) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  try {
    return NextResponse.json({ radars: await listRadars(authed.s, authed.user.id) });
  } catch (e) {
    console.error("[radar:list]", e instanceof Error ? e.name : "unknown");
    return NextResponse.json(
      { error: "Không tải được danh sách Radar." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authed = await auth();
  if (!authed) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const { s, user } = authed;

  const body = await req.json().catch(() => ({}));
  const v = validateRadarInput(body);
  if (!v.ok || !v.value)
    return NextResponse.json(
      { error: "Dữ liệu Radar chưa hợp lệ.", fieldErrors: v.errors },
      { status: 400 },
    );

  // market_listings chỉ mở cho service role -> phần tra danh sách khu vực dùng admin.
  const area = (await getRadarAreas(adminClient())).find(
    (x) => x.areaV2 === v.value!.areaV2,
  );
  if (!area)
    return NextResponse.json(
      { error: "Khu vực không còn trong dữ liệu CheckBDS." },
      { status: 400 },
    );

  // Ghi `radars` bằng session client để RLS chặn đúng người sở hữu.
  const { data, error } = await s
    .from("radars")
    .insert({
      user_id: user.id,
      name: v.value.name,
      area_v2: area.areaV2,
      area_name: area.areaName,
      region_name: area.regionName,
      category_code: v.value.categoryCode,
      price_min_vnd: v.value.priceMinVnd,
      price_max_vnd: v.value.priceMaxVnd,
      area_min_m2: v.value.areaMinM2,
      area_max_m2: v.value.areaMaxM2,
      min_score: v.value.minScore,
      deal_types: v.value.dealTypes,
      ngop_only: v.value.ngoPOnly,
      status: v.value.status,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[radar:create]", error?.code ?? "unknown");
    return NextResponse.json(
      { error: "Không tạo được Radar. Kiểm tra kết nối rồi thử lại." },
      { status: 500 },
    );
  }
  return NextResponse.json({ id: data.id });
}