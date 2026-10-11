// Deal Grader (PHASE 3) — chấm nhanh deterministic + ánh xạ đường AI + guard wording.
//
// Trọng tâm bảo vệ:
// - Bản "Chấm nhanh" thuần máy: KHÔNG fetch, KHÔNG DB, KHÔNG quota, KHÔNG cần auth.
// - Đường AI dùng lại /api/check: mọi mã trạng thái (401/429/5xx) phải giữ nguyên
//   bản chấm nhanh và KHÔNG bịa điểm AI.
// - Không phân loại chủ nhà / người môi giới: repo chưa có model đó.
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fromApiResponse, analyzeListing } from "../lib/scoring.ts";
import { runCheck } from "../lib/client-check.ts";
import {
  AI_QUOTA_NOTE,
  AI_SOURCE_LABEL,
  DEAL_GRADER_DISCLAIMER,
  FORBIDDEN_DEAL_CLAIMS,
  MAX_LISTING_LENGTH,
  MIN_LISTING_LENGTH,
  QUICK_SOURCE_LABEL,
  VERDICT_LABEL,
  buildDealGrade,
  cautiousPriceWording,
  isGradeableListing,
  quickGrade,
  verdictFor,
} from "../lib/deal-grader/preview.ts";
import {
  AI_UNAVAILABLE_MESSAGE,
  classifyAiOutcome,
} from "../lib/deal-grader/ai-outcome.ts";
import type { CheckApiResponse } from "../lib/types.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

const CLIENT_SRC = "components/deal-grader/deal-grader-client.tsx";
const PREVIEW_SRC = "lib/deal-grader/preview.ts";
const PAGE_SRC = "app/tools/cham-diem-tin-dang/page.tsx";

// Mẫu thật, đã dò bằng engine hiện có (không tự đặt ngưỡng mới).
const HOT =
  "Bán gấp! Nhà mặt tiền Thùy Vân 80m2, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi";
const MEDIUM = "Bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, hẻm xe hơi";
const LEGAL_RISK =
  "Cần bán nhà 60m2 giấy tay, đang tranh chấp với anh em trong nhà, giá 2 tỷ, hẻm nhỏ 2m";
const URGENT_SALE = "Bán gấp nhà 55m2, cần tiền gấp, kẹt tiền ngân hàng, giá 3.2 tỷ, sổ chung";

/** Quét mọi chuỗi mà view-model sinh ra. */
function gradeStrings(g: ReturnType<typeof quickGrade>): string[] {
  assert.ok(g, "grade phải khác null");
  return [
    g.sourceLabel,
    g.verdictLabel,
    g.disclaimer,
    ...g.signals.flatMap((s) => [s.label, s.value, s.note]),
    ...g.reasons.flatMap((r) => [r.label, r.note]),
    ...g.nextSteps,
  ];
}

function assertNoForbidden(strings: string[], where: string) {
  for (const text of strings) {
    for (const claim of FORBIDDEN_DEAL_CLAIMS) {
      assert.equal(
        text.toLowerCase().includes(claim.toLowerCase()),
        false,
        `${where}: không được chứa "${claim}" — gặp trong: ${text}`,
      );
    }
  }
}

console.log("\n== A. chấm nhanh deterministic ==");

check("tin bán gấp mạnh -> điểm cao + verdict call", () => {
  const g = quickGrade(HOT);
  assert.ok(g);
  assert.equal(g.source, "quick");
  assert.ok(g.score >= 80, `điểm ${g.score} phải >= 80`);
  assert.equal(g.verdict, "call");
  assert.equal(g.verdictLabel, "Nên gọi");
});

check("tin trung bình -> verdict check", () => {
  const g = quickGrade(MEDIUM);
  assert.ok(g);
  assert.ok(g.score >= 50 && g.score < 80, `điểm ${g.score} phải trong [50,80)`);
  assert.equal(g.verdict, "check");
  assert.equal(g.verdictLabel, "Cần kiểm tra thêm");
});

check("tin pháp lý xấu -> điểm thấp + verdict skip", () => {
  const g = quickGrade(LEGAL_RISK);
  assert.ok(g);
  assert.ok(g.score < 50, `điểm ${g.score} phải < 50`);
  assert.equal(g.verdict, "skip");
  assert.equal(g.verdictLabel, "Bỏ qua");
});

check("tin bán gấp (urgency) -> tín hiệu ngộp ở mức cao", () => {
  const g = quickGrade(URGENT_SALE);
  assert.ok(g);
  const urgency = g.signals.find((s) => s.key === "urgency");
  assert.ok(urgency, "phải có tín hiệu urgency");
  assert.ok(Number.parseInt(urgency.value, 10) > 40, `urgency ${urgency.value} phải > 40`);
});

check("tin pháp lý xấu -> tín hiệu pháp lý tone đỏ", () => {
  const g = quickGrade(LEGAL_RISK);
  assert.ok(g);
  const legal = g.signals.find((s) => s.key === "legal");
  assert.ok(legal);
  assert.equal(legal.tone, "red");
});

check("cùng input -> cùng output (deterministic)", () => {
  const a = quickGrade(HOT);
  const b = quickGrade(HOT);
  assert.deepEqual(a, b);
});

check("tin quá ngắn -> null, không chấm bừa", () => {
  assert.equal(quickGrade("nhà đẹp"), null);
  assert.equal(quickGrade(""), null);
  assert.equal(isGradeableListing("x".repeat(MIN_LISTING_LENGTH - 1)), false);
  assert.equal(isGradeableListing("x".repeat(MIN_LISTING_LENGTH)), true);
});

check("trần độ dài khớp chuẩn sản phẩm hiện tại (1000)", () => {
  assert.equal(MAX_LISTING_LENGTH, 1000);
});

console.log("\n== B. an toàn khi chưa đăng nhập ==");

check("chấm nhanh KHÔNG gọi mạng (không fetch)", () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("chấm nhanh không được gọi mạng");
  }) as unknown as typeof fetch;
  try {
    const g = quickGrade(HOT);
    assert.ok(g, "vẫn phải ra kết quả");
    assert.equal(calls, 0, `chấm nhanh đã gọi mạng ${calls} lần`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

check("chấm nhanh KHÔNG chạm Supabase/DB", () => {
  const src = readFileSync(PREVIEW_SRC, "utf8");
  for (const bad of ["supabase", "@supabase", ".insert(", ".from(", "createClient"]) {
    assert.equal(src.includes(bad), false, `module chấm nhanh không được chứa "${bad}"`);
  }
});

check("module chấm nhanh KHÔNG tự gọi /api/check", () => {
  const src = readFileSync(PREVIEW_SRC, "utf8");
  // Kiểm tra lời gọi thật (chuỗi URL literal + fetch), không tính comment.
  assert.equal(src.includes('"/api/check"'), false, "chấm nhanh không được gọi /api/check");
  assert.equal(src.includes("'/api/check'"), false, "chấm nhanh không được gọi /api/check");
  assert.equal(src.includes("fetch("), false, "chấm nhanh không được fetch");
  assert.equal(src.includes("await "), false, "chấm nhanh phải đồng bộ hoàn toàn, không có await");
});

check("nhãn nguồn nói rõ chưa dùng AI, không tự nhận là AI", () => {
  const g = quickGrade(HOT);
  assert.ok(g);
  assert.equal(g.sourceLabel, QUICK_SOURCE_LABEL);
  assert.match(g.sourceLabel, /CHƯA DÙNG AI/i, "phải nói rõ chưa dùng AI");
  // Không được tự nhận là AI, và không được nói AI đã phân tích.
  assert.equal(g.sourceLabel.includes(AI_SOURCE_LABEL), false);
  assert.equal(g.sourceLabel.toLowerCase().includes("ai đã"), false);
  assert.equal(g.sourceLabel.toLowerCase().includes("phân tích bằng ai"), false);
});

console.log("\n== C. ánh xạ đường AI (mock /api/check) ==");

const realFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

async function aiCase(name: string, fn: () => Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e: Error) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    })
    .finally(() => {
      globalThis.fetch = realFetch;
    });
}

async function main() {
  await aiCase("200 -> success, có checkId + seoSlug, giữ confidence", async () => {
    mockFetch(200, {
      check_id: "11111111-2222-3333-4444-555555555555",
      seo_slug: "ban-gap-nha-mat-tien-thuy-van-80m2-da-nang-5-5-ty-abc123",
      investment_score: 90,
      deal_type: "ngop_ngon",
      confidence: 0.82,
      is_ngop: 88,
      legal_safety: 90,
      location_growth: 92,
      liquidity: 85,
      province: "Đà Nẵng",
      cached: false,
    });
    const outcome = await runCheck(HOT);
    const state = classifyAiOutcome(outcome);
    assert.equal(state.kind, "success");
    assert.equal(outcome.source, "ai");
    assert.equal(outcome.checkId, "11111111-2222-3333-4444-555555555555");
    assert.ok(outcome.seoSlug, "phải giữ seo_slug");
    assert.equal(outcome.confidence, 0.82, "phải giữ confidence provider trả");
  });

  await aiCase("200 cached -> vẫn success, đánh dấu cached", async () => {
    mockFetch(200, {
      check_id: "11111111-2222-3333-4444-555555555555",
      seo_slug: null,
      investment_score: 62,
      deal_type: "binh_thuong",
      confidence: 0.6,
      is_ngop: 30,
      legal_safety: 70,
      location_growth: 60,
      liquidity: 55,
      cached: true,
    });
    const outcome = await runCheck(HOT);
    const state = classifyAiOutcome(outcome);
    assert.equal(state.kind, "success");
    if (state.kind === "success") assert.equal(state.cached, true, "phải đánh dấu cached");
  });

  await aiCase("401 -> auth_required, KHÔNG phải kết quả AI", async () => {
    mockFetch(401, { error: "Cần đăng nhập" });
    const outcome = await runCheck(HOT);
    const state = classifyAiOutcome(outcome);
    assert.equal(state.kind, "auth_required");
    assert.notEqual(outcome.source, "ai");
  });

  await aiCase("429 -> quota_exhausted + giữ nguyên thông báo server", async () => {
    mockFetch(429, { error: "Hết 20 lượt check/ngày của gói free. Nâng cấp Pro để check thêm." });
    const outcome = await runCheck(HOT);
    const state = classifyAiOutcome(outcome);
    assert.equal(state.kind, "quota_exhausted");
    if (state.kind === "quota_exhausted") {
      assert.match(state.message, /Hết 20 lượt/, "phải giữ nguyên thông báo server");
    }
  });

  for (const status of [502, 503]) {
    await aiCase(`${status} -> unavailable, KHÔNG bịa điểm AI`, async () => {
      mockFetch(status, { error: "Jev lỗi" });
      const outcome = await runCheck(HOT);
      const state = classifyAiOutcome(outcome);
      assert.equal(state.kind, "unavailable");
      if (state.kind === "unavailable") assert.equal(state.message, AI_UNAVAILABLE_MESSAGE);
      assert.notEqual(outcome.source, "ai", "lỗi AI không được gắn nhãn AI");
    });
  }

  await aiCase("500 -> unavailable (không phải hết lượt)", async () => {
    mockFetch(500, { error: "Lỗi máy chủ" });
    const outcome = await runCheck(HOT);
    assert.equal(classifyAiOutcome(outcome).kind, "unavailable");
  });

  await aiCase("lỗi mạng -> unavailable, không throw ra UI", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const outcome = await runCheck(HOT);
    assert.equal(classifyAiOutcome(outcome).kind, "unavailable");
  });

  await aiCase("200 nhưng thiếu investment_score -> unavailable, không hiện điểm AI giả", async () => {
    mockFetch(200, { check_id: "x", deal_type: "binh_thuong" });
    const outcome = await runCheck(HOT);
    assert.equal(classifyAiOutcome(outcome).kind, "unavailable");
  });

  console.log("\n== D. ánh xạ verdict ==");

  check("hot -> Nên gọi", () => {
    assert.equal(verdictFor("hot"), "call");
    assert.equal(VERDICT_LABEL.call, "Nên gọi");
  });

  check("ok -> Cần kiểm tra thêm", () => {
    assert.equal(verdictFor("ok"), "check");
    assert.equal(VERDICT_LABEL.check, "Cần kiểm tra thêm");
  });

  check("skip -> Bỏ qua", () => {
    assert.equal(verdictFor("skip"), "skip");
    assert.equal(VERDICT_LABEL.skip, "Bỏ qua");
  });

  check("verdict bám đúng actionType của engine, không có ngưỡng mới", () => {
    for (const [text, expected] of [
      [HOT, "call"],
      [MEDIUM, "check"],
      [LEGAL_RISK, "skip"],
    ] as const) {
      const local = analyzeListing(text);
      const g = quickGrade(text);
      assert.ok(g);
      assert.equal(g.verdict, verdictFor(local.actionType), `${text.slice(0, 20)} lệch verdict`);
      assert.equal(g.verdict, expected);
    }
  });

  check("bản AI dùng CÙNG view-model, chỉ đổi nguồn", () => {
    const local = analyzeListing(HOT);
    const merged = fromApiResponse(
      {
        investment_score: 91,
        deal_type: "ngop_ngon",
        confidence: 0.77,
        is_ngop: 90,
        legal_safety: 88,
        location_growth: 95,
        liquidity: 80,
        province: "Đà Nẵng",
      } as CheckApiResponse,
      local,
    );
    const g = buildDealGrade({ result: merged, source: "ai", confidence: 0.77 });
    assert.equal(g.source, "ai");
    assert.equal(g.sourceLabel, AI_SOURCE_LABEL);
    assert.equal(g.score, 91, "phải lấy điểm AI");
    assert.equal(g.verdict, "call");
    // 5 tín hiệu gốc + 1 tín hiệu confidence của đường AI
    assert.equal(g.signals.length, 6);
    const conf = g.signals.find((s) => s.key === "confidence");
    assert.ok(conf, "đường AI phải hiện confidence");
    assert.equal(conf.value, "77%");
  });

  check("confidence null -> KHÔNG hiện ô confidence (không bịa 0%)", () => {
    const local = analyzeListing(HOT);
    const merged = fromApiResponse(
      { investment_score: 70, deal_type: "binh_thuong", confidence: null } as CheckApiResponse,
      local,
    );
    const g = buildDealGrade({ result: merged, source: "ai", confidence: null });
    assert.equal(g.signals.some((s) => s.key === "confidence"), false);
    assert.equal(g.signals.length, 5);
  });

  check("verdict bám engine: điểm >= 80 luôn là call, kể cả deal rủi ro pháp lý", () => {
    // Đây là semantics SẴN CÓ của fromApiResponse (score >= 80 -> hot). Phase này
    // không đổi ngưỡng. Rủi ro pháp lý vẫn phải nhìn thấy được ở ô tín hiệu riêng,
    // nên điểm cao KHÔNG được che mất cảnh báo pháp lý.
    const local = analyzeListing(HOT);
    const merged = fromApiResponse(
      {
        investment_score: 85,
        deal_type: "rui_ro_phap_ly",
        confidence: 0.9,
        legal_safety: 15,
      } as CheckApiResponse,
      local,
    );
    const g = buildDealGrade({ result: merged, source: "ai" });
    assert.equal(g.verdict, verdictFor(merged.actionType), "verdict phải bám actionType engine");
    assert.equal(g.verdict, "call");
    // legal_safety 15 (noul 0..100) -> ô pháp lý phải là tone đỏ, không bị điểm cao che.
    const legal = g.signals.find((s) => s.key === "legal");
    assert.ok(legal);
    assert.equal(legal.tone, "red", "pháp lý yếu phải hiện đỏ dù điểm tổng cao");
    assert.equal(legal.value, "Tín hiệu thấp");
  });

  check("điểm < 50 với deal rủi ro pháp lý -> skip (đúng nhánh engine)", () => {
    const local = analyzeListing(HOT);
    const merged = fromApiResponse(
      { investment_score: 40, deal_type: "rui_ro_phap_ly", confidence: 0.8 } as CheckApiResponse,
      local,
    );
    assert.equal(buildDealGrade({ result: merged, source: "ai" }).verdict, "skip");
  });

  console.log("\n== E. không ship phân loại chủ nhà / môi giới ==");

  check("signal keys KHÔNG có owner/broker", () => {
    const g = quickGrade(HOT);
    assert.ok(g);
    const keys = g.signals.map((s) => s.key);
    assert.deepEqual(
      [...keys].sort(),
      ["legal", "liquidity", "location", "price", "urgency"],
      "bộ tín hiệu phải đúng 5 khoá đã định, không thêm khoá phân loại người đăng",
    );
  });

  check("view-model KHÔNG có field phân loại người đăng", () => {
    const g = quickGrade(HOT);
    assert.ok(g);
    const json = JSON.stringify(g).toLowerCase();
    for (const bad of ["ownertype", "broker", "chinhchu", "moigioi", "is_owner", "seller_type"]) {
      assert.equal(json.includes(bad), false, `view-model không được chứa "${bad}"`);
    }
  });

  check("component KHÔNG dựng phân loại từ SĐT / tên / regex", () => {
    const src = readFileSync(CLIENT_SRC, "utf8").toLowerCase();
    for (const bad of ["ownertype", "brokertype", "chinhchu", "moigioi", "extractphone", "detectowner"]) {
      assert.equal(src.includes(bad), false, `component không được chứa "${bad}"`);
    }
  });

  check("không quảng cáo tính năng chưa có (fake/scam detector, định giá chuẩn)", () => {
    // Các cụm này ĐƯỢC PHÉP xuất hiện khi đang phủ định ("không phải định giá
    // thị trường") — đó chính là cách nói thật. Chỉ chặn khi dùng như lời quảng cáo.
    const NEGATIONS = ["không phải", "không thay thế", "không đối chiếu", "không xác minh", "không"];
    const BANNED = [
      "tin giả",
      "lừa đảo",
      "scam",
      "fake listing",
      "định giá thị trường",
      "giá thị trường chính xác",
      "pháp lý đã xác minh",
      "xác minh pháp lý tự động",
    ];
    for (const file of [CLIENT_SRC, PAGE_SRC, PREVIEW_SRC]) {
      let src = readFileSync(file, "utf8").toLowerCase();
      // Bỏ chính khối khai báo danh sách cấm: nó chứa các cụm này một cách hợp lệ
      // (đó là định nghĩa guard, không phải lời quảng cáo).
      const declStart = src.indexOf("export const forbidden_deal_claims");
      if (declStart !== -1) {
        const declEnd = src.indexOf("as const;", declStart);
        if (declEnd !== -1) {
          src = src.slice(0, declStart) + src.slice(declEnd + "as const;".length);
        }
      }
      for (const bad of BANNED) {
        let from = 0;
        for (;;) {
          const at = src.indexOf(bad, from);
          if (at === -1) break;
          from = at + bad.length;
          // Cửa sổ 40 ký tự TRƯỚC và 24 ký tự SAU cụm: tiếng Việt có thể phủ
          // định ở sau ("... định giá thị trường không?"), nên phải nhìn cả hai phía.
          const before = src.slice(Math.max(0, at - 40), at);
          const after = src.slice(at + bad.length, at + bad.length + 24);
          const negated = NEGATIONS.some((n) => before.includes(n) || after.includes(n));
          assert.ok(
            negated,
            `${file}: "${bad}" chỉ được xuất hiện dưới dạng phủ định, nhưng đang là lời khẳng định`,
          );
        }
      }
    }
  });

  console.log("\n== F. guard wording ==");

  check("mọi chuỗi view-model sạch claim bị cấm", () => {
    for (const text of [HOT, MEDIUM, LEGAL_RISK, URGENT_SALE]) {
      const g = quickGrade(text);
      assertNoForbidden(gradeStrings(g), `grade(${text.slice(0, 16)})`);
    }
  });

  check("bản AI cũng sạch claim bị cấm", () => {
    const local = analyzeListing(HOT);
    const merged = fromApiResponse(
      {
        investment_score: 88,
        deal_type: "ngop_ngon",
        confidence: 0.8,
        legal_safety: 95,
        province: "Đà Nẵng",
      } as CheckApiResponse,
      local,
    );
    assertNoForbidden(gradeStrings(buildDealGrade({ result: merged, source: "ai", confidence: 0.8 })), "ai");
  });

  check("disclaimer nói rõ không thay thế xác minh", () => {
    assert.match(DEAL_GRADER_DISCLAIMER, /không thay thế/i);
    assert.match(DEAL_GRADER_DISCLAIMER, /quy hoạch/i);
    assert.match(DEAL_GRADER_DISCLAIMER, /giá thị trường/i);
    assertNoForbidden([DEAL_GRADER_DISCLAIMER], "disclaimer");
  });

  check("wording giá không nói là định giá thị trường", () => {
    for (const diff of [-20, -5, 0, 5, 20]) {
      const w = cautiousPriceWording(diff);
      assert.equal(w.toLowerCase().includes("định giá"), false);
      assert.equal(w.toLowerCase().includes("thị trường chính xác"), false);
    }
    assert.match(cautiousPriceWording(15), /thấp hơn/i);
    assert.match(cautiousPriceWording(-15), /cao hơn/i);
  });

  check("nhãn tín hiệu giá nói rõ nguồn là nội dung tin", () => {
    const g = quickGrade(HOT);
    assert.ok(g);
    const price = g.signals.find((s) => s.key === "price");
    assert.ok(price);
    assert.equal(price.label, "TÍN HIỆU GIÁ TỪ NỘI DUNG TIN");
  });

  check("pháp lý luôn kèm yêu cầu tự xác minh", () => {
    for (const text of [HOT, MEDIUM, LEGAL_RISK]) {
      const g = quickGrade(text);
      assert.ok(g);
      const legal = g.signals.find((s) => s.key === "legal");
      assert.ok(legal);
      assert.match(legal.note, /xác minh/i, "gợi ý pháp lý phải nhắc tự xác minh");
    }
  });

  check("quota copy nói dùng quota hiện có, KHÔNG quảng cáo '3 lượt/ngày'", () => {
    assert.match(AI_QUOTA_NOTE, /quota/i);
    assert.match(AI_QUOTA_NOTE, /20/);
    assert.match(AI_QUOTA_NOTE, /500/);
    assert.equal(AI_QUOTA_NOTE.includes("3 lượt"), false);
    assert.equal(AI_QUOTA_NOTE.toLowerCase().includes("3 free"), false);
    assert.match(AI_QUOTA_NOTE, /không có hạn mức riêng/i);
  });

  check("confidence không bị mô tả thành 'tin thật'", () => {
    const local = analyzeListing(HOT);
    const merged = fromApiResponse(
      { investment_score: 80, deal_type: "ngop_ngon", confidence: 0.9 } as CheckApiResponse,
      local,
    );
    const g = buildDealGrade({ result: merged, source: "ai", confidence: 0.9 });
    const conf = g.signals.find((s) => s.key === "confidence");
    assert.ok(conf);
    assert.match(conf.note, /không phải xác suất tin là thật/i);
  });

  console.log("\n== G. route / a11y / mobile source ==");

  check("route page tồn tại + export metadata", () => {
    assert.ok(existsSync(PAGE_SRC), `${PAGE_SRC} phải tồn tại`);
    const src = readFileSync(PAGE_SRC, "utf8");
    assert.ok(src.includes("export const metadata"), "phải có metadata");
    assert.ok(src.includes("/tools/cham-diem-tin-dang"), "canonical phải trỏ đúng route");
    assert.ok(src.includes("Chấm điểm tin đăng BĐS trước khi gọi"), "phải có H1");
  });

  check("textarea + nút chấm nhanh có nhãn và aria", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    assert.ok(src.includes("<textarea"), "phải dùng textarea");
    assert.ok(src.includes('htmlFor="deal-listing"'), "label phải gắn với textarea");
    assert.ok(src.includes('id="deal-listing"'), "textarea phải có id khớp label");
    assert.ok(src.includes("aria-describedby"), "textarea phải có mô tả trợ năng");
    assert.ok(src.includes("maxLength={MAX_LISTING_LENGTH}"), "textarea phải có trần ký tự");
    assert.ok(src.includes("aria-disabled"), "nút phải có aria-disabled");
  });

  check("nút chính đạt tap target >= 48px (mobile 390)", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    const heights = [...src.matchAll(/h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    assert.ok(heights.length >= 3, "phải có các nút chiều cao cố định");
    for (const h of heights) assert.ok(h >= 48, `nút ${h}px phải >= 48px`);
  });

  check("nút chính KHÔNG dùng flex-1 trần trong cột (co chiều cao còn 26px)", () => {
    // Bug thật đã gặp: `flex flex-col` + con `flex-1` -> flex-basis 0% trên trục
    // DỌC, nút h-[52px] bị co còn 26px trên mobile. flex-1 chỉ được dùng từ `sm:`
    // trở lên (khi container đã chuyển sang hàng ngang).
    const src = readFileSync(CLIENT_SRC, "utf8");
    for (const m of src.matchAll(/className=\{`[^`]*`\}/g)) {
      const cls = m[0];
      if (!cls.includes("h-[52px]")) continue;
      assert.equal(
        /(^|\s)flex-1(\s|$)/.test(cls),
        false,
        `nút h-[52px] không được dùng flex-1 trần (phải là sm:flex-1): ${cls.slice(0, 120)}`,
      );
    }
  });

  check("CTA đăng nhập giữ đường quay lại đúng trang", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    assert.ok(src.includes("/login?next="), "CTA login phải kèm next");
    assert.ok(src.includes("savePendingReport"), "phải lưu pending để không mất nội dung đã dán");
    assert.ok(src.includes("SELF_PATH"), "phải dùng hằng đường dẫn của chính trang");
  });

  check("không ăn mất pending-report của trang khác", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    assert.ok(
      src.includes("pending.returnTo.startsWith(SELF_PATH)"),
      "phải kiểm tra returnTo trước khi nhận pending",
    );
    assert.ok(src.includes("savePendingReport(pending)"), "pending của trang khác phải được trả lại");
  });

  console.log("\n== H. phạm vi: không đụng /api/check ==");

  check("/api/check route KHÔNG bị sửa bởi phase này", () => {
    const src = readFileSync("app/api/check/route.ts", "utf8");
    assert.ok(src.includes("handleCheck"), "route vẫn uỷ quyền cho handleCheck");
    assert.ok(src.includes("callJev"), "route vẫn wiring Jev thật");
    assert.equal(src.includes("deal-grader"), false, "route check không được biết tới deal grader");
    assert.equal(src.includes("cham-diem-tin-dang"), false);
  });

  check("không có hạn mức / quota riêng cho Deal Grader", () => {
    for (const file of [CLIENT_SRC, PREVIEW_SRC, PAGE_SRC]) {
      const src = readFileSync(file, "utf8").toLowerCase();
      assert.equal(src.includes("deal_grader_quota"), false, `${file} không được có quota riêng`);
      assert.equal(src.includes("dealgraderlimit"), false, `${file} không được có limit riêng`);
    }
  });

  check("không tạo endpoint AI mới", () => {
    assert.equal(
      existsSync("app/api/deal-grader"),
      false,
      "không được tạo endpoint AI mới cho Deal Grader",
    );
    const src = readFileSync(CLIENT_SRC, "utf8");
    assert.ok(src.includes('runCheck(trimmed)'), "đường AI phải đi qua runCheck hiện có");
    assert.ok(src.includes('from "@/lib/client-check"'), "phải dùng lại client-check hiện có");
  });

  check("sitemap có route mới", () => {
    const src = readFileSync("app/sitemap.ts", "utf8");
    assert.ok(src.includes("/tools/cham-diem-tin-dang"), "sitemap phải có route Deal Grader");
  });

  check("analytics dùng đúng bộ event đã khai báo, không đếm trùng", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    const events = [...src.matchAll(/trackEvent\("([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      [...events].sort(),
      ["deal_grader_ai_click", "deal_grader_ai_success", "deal_grader_login_click", "deal_grader_preview"],
      "phải dùng đúng 4 event của Deal Grader",
    );
    // runCheck() đã tự phát property_checked / free_limit_reached / login_clicked.
    // Phát lại ở đây là đếm trùng phễu.
    for (const dup of ["property_checked", "free_limit_reached", "login_clicked", "cta_clicked"]) {
      assert.equal(src.includes(`trackEvent("${dup}"`), false, `không được phát lại ${dup}`);
    }
  });

  check("event Deal Grader đã khai báo trong FunnelEvent", () => {
    const src = readFileSync("lib/analytics.ts", "utf8");
    for (const e of [
      "deal_grader_preview",
      "deal_grader_ai_click",
      "deal_grader_login_click",
      "deal_grader_ai_success",
    ]) {
      assert.ok(src.includes(`"${e}"`), `FunnelEvent phải khai báo ${e}`);
    }
  });

  check("không gửi PII vào analytics", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    for (const m of src.matchAll(/trackEvent\([^)]*\)/g)) {
      const call = m[0];
      for (const bad of ["trimmed", "text", "email", "phone", "listingUrl"]) {
        assert.equal(call.includes(bad), false, `event không được chứa ${bad}: ${call}`);
      }
    }
  });

  check("FAQ chỉ mô tả đúng năng lực thật", () => {
    const src = readFileSync(PAGE_SRC, "utf8");
    assert.ok(src.includes("FAQPage"), "phải có structured data FAQ");
    assert.ok(src.includes("Không. Phiên bản này không phân loại"), "phải nói rõ không phân loại người đăng");
    assert.ok(src.includes("không phải định giá thị trường"), "phải nói rõ không định giá thị trường");
    assert.equal(src.includes("Đã xác minh"), false);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
