import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { parseUserIdFromContent, planFromAmount, transferContent } from "@/lib/payments";
import { nextExpiry } from "@/lib/quota";

// Webhook SePay: ngân hàng báo có tiền -> tự nâng plan
// Doc: https://docs.sepay.vn
// Nguyên tắc: mọi khoản tiền vào đều phải có dấu vết trong bảng payments
// (status=unmatched nếu không khớp), để admin đối chiếu và xử lý tay — không để mất dấu.

// Chuẩn hoá token xác thực SePay gửi lên: chấp nhận "Apikey X", "Bearer X" hoặc X
function readAuth(req: NextRequest): string {
  const raw =
    req.headers.get("authorization") ??
    req.headers.get("x-api-key") ??
    req.headers.get("x-sepay-api-key") ??
    "";
  return raw.replace(/^(apikey|bearer)\s+/i, "").trim();
}

// Chỉ log vài ký tự đầu để đối chiếu, không để lộ key
function mask(token: string): string {
  return token ? `${token.slice(0, 4)}…(${token.length} ký tự)` : "(rỗng)";
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.SEPAY_API_KEY;
  if (!apiKey) {
    console.error("[sepay] MISSING_SEPAY_API_KEY");
    return NextResponse.json({ error: "Chưa cấu hình SEPAY_API_KEY" }, { status: 500 });
  }

  const token = readAuth(req);
  if (token !== apiKey) {
    console.warn(`[sepay] AUTH_FAIL got=${mask(token)} expect=${mask(apiKey)}`);
    return NextResponse.json({ error: "Sai API key" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Payload không hợp lệ" }, { status: 400 });
  }

  const content: string = payload.content ?? payload.description ?? "";
  const amount: number = Number(payload.transferAmount ?? payload.amount ?? 0);
  const ref: string | null = payload.referenceCode ?? payload.code ?? null;

  // Service role: webhook không có session user, cần quyền ghi vượt RLS
  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Ghi nhận một khoản tiền vào chưa nâng được gói (admin đối chiếu sau)
  const recordUnmatched = async (userId: string | null, reason: string) => {
    await admin.from("payments").insert({
      user_id: userId,
      plan: "unmatched",
      amount,
      transfer_content: `${content} (${reason})`.slice(0, 200),
      status: "unmatched",
      sepay_ref: ref,
    });
    console.log(`[sepay] UNMATCHED reason=${reason} amount=${amount} ref=${ref ?? "-"}`);
    return NextResponse.json({ ok: true, unmatched: reason });
  };

  // Chỉ xử lý tiền vào
  if (payload.transferType && payload.transferType !== "in") {
    return NextResponse.json({ ok: true, skipped: "not-inbound" });
  }

  // Nhận diện user từ nội dung CK: NANGCAP {uuid} (ngân hàng có thể bỏ dấu gạch)
  const userId = parseUserIdFromContent(content);
  if (!userId) {
    console.warn(`[sepay] NO_MATCH content=${content.slice(0, 120)}`);
    return recordUnmatched(null, "khong-nhan-dien-duoc-nguoi-chuyen");
  }

  const plan = planFromAmount(amount);
  if (!plan || plan === "free") {
    // Có người chuyển nhưng số tiền chưa đủ gói -> vẫn ghi lại để admin biết
    return recordUnmatched(userId, "so-tien-chua-du-goi");
  }

  // Idempotent: đã ghi nhận giao dịch này thì bỏ qua
  if (ref) {
    const { data: dup } = await admin
      .from("payments")
      .select("id")
      .eq("sepay_ref", ref)
      .eq("status", "paid")
      .maybeSingle();
    if (dup) return NextResponse.json({ ok: true, skipped: "duplicate" });
  }

  // Ưu tiên cập nhật bản ghi pending của user (khớp đúng nội dung CK)
  const { data: pending } = await admin
    .from("payments")
    .select("id")
    .eq("user_id", userId)
    .eq("transfer_content", transferContent(userId))
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending) {
    await admin
      .from("payments")
      .update({ status: "paid", sepay_ref: ref, plan, amount })
      .eq("id", pending.id);
  } else {
    await admin.from("payments").insert({
      user_id: userId,
      plan,
      amount,
      transfer_content: content.slice(0, 200),
      status: "paid",
      sepay_ref: ref,
    });
  }

  // Nâng gói user: mỗi lần thanh toán cộng 30 ngày vào hạn đang có
  const { data: payer } = await admin
    .from("users")
    .select("plan_expires_at")
    .eq("id", userId)
    .maybeSingle();

  const expiresAt = nextExpiry(payer?.plan_expires_at);
  await admin.from("users").update({ plan, plan_expires_at: expiresAt }).eq("id", userId);

  console.log(`[sepay] plan=${plan} user=${userId} amount=${amount} expires=${expiresAt} ref=${ref ?? "-"}`);

  return NextResponse.json({ ok: true, plan, plan_expires_at: expiresAt });
}
