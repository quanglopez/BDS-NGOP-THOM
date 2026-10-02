import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { getRadar, getRadarAreas } from "@/lib/radar/data";
import { validateRadarInput } from "@/lib/radar/criteria";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** Session client: `radars` đọc/ghi theo RLS (chỉ dòng của chính user). */
async function uid(): Promise<{ s: SupabaseClient; user: User } | null> {
  const s = await createClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  return user ? { s, user } : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const authed = await uid();
  if (!authed) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  try {
    const radar = await getRadar(authed.s, authed.user.id, id);
    if (!radar) return NextResponse.json({ error: "Không tìm thấy Radar." }, { status: 404 });
    return NextResponse.json({ radar });
  } catch (e) {
    console.error("[radar:get]", e instanceof Error ? e.name : "unknown");
    return NextResponse.json(
      { error: "Không tải được Radar." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const authed = await uid();
  if (!authed) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const { s, user } = authed;

  const body = await req.json().catch(() => ({}));

  let existing;
  try {
    existing = await getRadar(s, user.id, id);
  } catch (e) {
    console.error("[radar:update:load]", e instanceof Error ? e.name : "unknown");
    return NextResponse.json(
      { error: "Không tải được Radar." },
      { status: 500 },
    );
  }
  if (!existing) return NextResponse.json({ error: "Không tìm thấy Radar." }, { status: 404 });

  // PATCH sửa MỘT PHẦN: ghép chỉ số trên bản ghi hiện tại rồi validate cả bản ghép.
  // Validate thẳng `body` sẽ 400 mọi lệnh chỉ gửi `{ status }` (pause/resume ở
  // RadarCard) vì thiếu name/areaV2 — xem .superpowers/sdd/keo-radar-v1/progress.md.
  const patch =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const v = validateRadarInput({ ...existing, ...patch });
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

  const { error } = await s
    .from("radars")
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[radar:update]", error.code);
    return NextResponse.json(
      { error: "Không lưu được Radar." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const authed = await uid();
  if (!authed) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const { s, user } = authed;

  // RLS chỉ cho xoá dòng của chính user; `.eq` giữ lại lớp phòng thủ.
  const { error } = await s.from("radars").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    console.error("[radar:delete]", error.code);
    return NextResponse.json(
      { error: "Không xoá được Radar." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}