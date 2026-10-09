import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import {
  parseMonthsFromContent,
  parseUserIdFromContent,
  planFromAmount,
  transferContent,
  DURATIONS,
  quotePrice,
  type PlanKey,
} from "@/lib/payments";
import { nextExpiry } from "@/lib/quota";

// Webhook SePay — https://developer.sepay.vn/vi/sepay-webhooks
//
// SePay CHỈ coi là thành công khi: HTTP 200/201 + body `{"success": true}` + trong 30s.
// Sai một trong ba -> SePay retry tối đa 7 lần theo dãy Fibonacci trong 5 giờ.
// Vì vậy mọi nhánh trả về đều phải kèm `success`.
//
// Xác thực (chọn 1 trong 4 cách SePay hỗ trợ, cấu hình ở Bước 3 lúc tạo webhook):
//   1. SEPAY_WEBHOOK_SECRET  -> HMAC-SHA256 qua X-SePay-Signature (khuyến nghị)
//   2. SEPAY_API_KEY         -> header Authorization: Apikey {key}
//   3. Cả hai đều rỗng      -> không xác thực (chỉ để test, KHÔNG dùng production)
// Key/secret của SePay chỉ hiện đầy đủ đúng một lần, mở lại chỉ thấy 4 ký tự cuối.

function ok(body: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...body }, { status: 200 });
}

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

// So sánh thời gian cố định để tránh rò rỉ qua thời gian phản hồi
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Xác thực HMAC-SHA256: chữ ký = HMAC(secret, "{timestamp}.{rawBody}")
function verifyHmac(rawBody: string, req: NextRequest, secret: string): boolean {
  const signature = req.headers.get("x-sepay-signature") ?? "";
  const timestamp = Number(req.headers.get("x-sepay-timestamp") ?? 0);
  // Chống replay: timestamp lệch quá 5 phút là 401
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  return safeEqual(signature, expected);
}

function verifyApiKey(req: NextRequest, apiKey: string): boolean {
  const raw = (
    req.headers.get("authorization") ??
    req.headers.get("x-api-key") ??
    req.headers.get("x-sepay-api-key") ??
    ""
  )
    .replace(/^(apikey|bearer)\s+/i, "")
    .trim();
  return safeEqual(raw, apiKey);
}

// Chẩn đoán cấu hình (GET, không lộ giá trị key — chỉ cho biết có/không và độ dài).
// Mở trực tiếp trong trình duyệt để đối chiếu với cấu hình Bước 3 trên SePay.
export async function GET() {
  const secret = process.env.SEPAY_WEBHOOK_SECRET ?? "";
  const apiKey = process.env.SEPAY_API_KEY ?? "";
  return ok({
    mode: secret ? "hmac" : apiKey ? "apikey" : "khong-xac-thuc",
    secret: secret ? "da-dat" : "chua-dat",
    apiKey: apiKey ? "da-dat" : "chua-dat",
    apiKeyLength: apiKey.length,
    // Gợi ý kiểm tra khi khác nhau:
    hint: "Đối chiếu giá trị này với Bước 3 'Bảo mật' trên my.sepay.vn/webhooks. SePay chỉ hiện key đầy đủ 1 lần duy nhất.",
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.SEPAY_WEBHOOK_SECRET ?? "";
  const apiKey = process.env.SEPAY_API_KEY ?? "";

  if (!secret && !apiKey) {
    console.warn(
      "[sepay] WARNING: chua dat SEPAY_WEBHOOK_SECRET hoac SEPAY_API_KEY — dang mo webhook khong xac thuc. KHONG dung o production.",
    );
  }

  // Đọc raw body TRƯỚC khi parse: HMAC ký trên bytes gốc, re-serialize sẽ lệch chữ ký
  const rawBody = await req.text();

  if (secret) {
    if (!verifyHmac(rawBody, req, secret)) {
      console.warn(`[sepay] HMAC_FAIL ts=${req.headers.get("x-sepay-timestamp") ?? "-"}`);
      return fail("Chữ ký không hợp lệ", 401);
    }
  } else if (apiKey && !verifyApiKey(req, apiKey)) {
    // Chỉ log 4 ký tự đầu + độ dài, không lộ key
    const got = (req.headers.get("authorization") ?? "").replace(/^(apikey|bearer)\s+/i, "").trim();
    console.warn(`[sepay] AUTH_FAIL got=${got.slice(0, 4)}…(${got.length} ký tự) expect=${apiKey.slice(0, 4)}…(${apiKey.length} ký tự)`);
    return fail("Sai API key", 401);
  }

  const payload = (() => {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (!payload) return fail("Payload không hợp lệ", 400);

  // Service role: webhook không có session user, cần quyền ghi vượt RLS
  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const content: string = String(payload.content ?? payload.description ?? "");
  const amount: number = Number(payload.transferAmount ?? payload.amount ?? 0);
  // SePay khuyến nghị chống trùng theo trường `id` của payload (retry + gửi tay)
  const txnId = payload.id != null ? String(payload.id) : null;
  const reference = (payload.referenceCode ?? payload.code ?? null) as string | null;
  const ref = txnId ?? reference;

  // Ghi nhận khoản tiền vào chưa nâng được gói — admin đối chiếu và xử lý tay
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
    // vẫn trả success để SePay không retry vô ích — admin sẽ xử lý tay
    return ok({ unmatched: reason });
  };

  // Chỉ xử lý tiền vào
  if (payload.transferType && payload.transferType !== "in") {
    return ok({ skipped: "not-inbound" });
  }

  const userId = parseUserIdFromContent(content);
  if (!userId) {
    console.warn(`[sepay] NO_MATCH content=${content.slice(0, 120)}`);
    return recordUnmatched(null, "khong-nhan-dien-duoc-nguoi-chuyen");
  }

  // Gói mua nhiều tháng ghi trong nội dung CK (NANGCAP {uuid} T12).
  // Có số tháng thì gói Pro — tránh suy theo tiền bị nhầm sang gói Team.
  // Nhưng số tháng VÀ số tiền phải khớp nhau: không có gói giá số tháng đó, hoặc
  // tiền ít hơn giá của gói, thì ghi unmatched và KHÔNG nâng gói.
  const months = parseMonthsFromContent(content);

  let plan: PlanKey | null;
  if (months > 1) {
    // Số tháng phải là gói có giá thật (tránh mọi số tháng đều suy ra gói 1 tháng)
    const tier = DURATIONS.find((d) => d.months === months);
    if (!tier) {
      return recordUnmatched(userId, "thang-khong-co-gia");
    }
    // Tiền phải đủ giá gói, so sánh dạng >= để NaN/âm/thiếu đều bị từ chối
    if (!(amount >= quotePrice(tier.months).total)) {
      return recordUnmatched(userId, "so-tien-chua-du-goi");
    }
    plan = "pro";
  } else {
    // Không có số tháng: giữ nguyên luật cũ suy gói theo tiền
    plan = planFromAmount(amount);
    if (!plan || plan === "free") {
      return recordUnmatched(userId, "so-tien-chua-du-goi");
    }
  }

  // Idempotent: cùng một giao dịch có thể được gửi lại nhiều lần
  if (ref) {
    const { data: dup } = await admin
      .from("payments")
      .select("id")
      .eq("sepay_ref", ref)
      .eq("status", "paid")
      .maybeSingle();
    if (dup) return ok({ skipped: "duplicate" });
  }

  // Ưu tiên cập nhật bản ghi pending của user (khớp đúng nội dung CK)
  const { data: pending } = await admin
    .from("payments")
    .select("id")
    .eq("user_id", userId)
    .eq("transfer_content", transferContent(userId, months))
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

  // Nâng gói user: cộng dồn months × 30 ngày vào hạn đang có
  const { data: payer } = await admin
    .from("users")
    .select("plan_expires_at")
    .eq("id", userId)
    .maybeSingle();

  const expiresAt = nextExpiry(payer?.plan_expires_at, months);
  await admin.from("users").update({ plan, plan_expires_at: expiresAt }).eq("id", userId);

  console.log(
    `[sepay] plan=${plan} months=${months} user=${userId} amount=${amount} expires=${expiresAt} ref=${ref ?? "-"}`,
  );

  return ok({ plan, months, plan_expires_at: expiresAt });
}
