// Self-check: Pro Analysis — evidence pack, schema, guard, fallback. Chạy: npm test
// Không gọi mạng, không cần OPENROUTER_API_KEY.
import { strict as assert } from "node:assert";
import { buildEvidencePack, calcPricePerM2 } from "../lib/ai/evidence.ts";
import { parseProAnalysis, type ProAnalysis } from "../lib/ai/schema.ts";
import { guardProAnalysis } from "../lib/ai/guard.ts";
import { buildFallbackAnalysis, generateProAnalysis } from "../lib/ai/pro-analysis.ts";
import { analyzeListing } from "../lib/scoring.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e: Error) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

const SAMPLE_TEXT =
  "Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi, liên hệ 0909123456";

function sampleEvidence() {
  const result = analyzeListing(SAMPLE_TEXT);
  return buildEvidencePack({
    title: SAMPLE_TEXT.slice(0, 120),
    price: 5500000000,
    area: 80,
    bedrooms: 4,
    ward: null,
    region: "Vũng Tàu",
    listingUrl: "https://www.nhatot.com/tin/1.htm",
    listingText: SAMPLE_TEXT,
    result,
    dealType: "ngop_ngon",
    scoringVersion: "jev-v1",
    analysisVersion: "pro-v1",
  });
}

function sampleAnalysis(): ProAnalysis {
  return {
    summary: { headline: "Tin 72/100 điểm", text: "Dữ liệu hiện tại cho thấy tiềm năng.", confidence: "medium" },
    highlights: [
      { type: "positive", title: "Giá cạnh tranh", explanation: "Thấp hơn mặt bằng.", evidence_source: "scoring" },
    ],
    score_explanation: {
      summary: "Điểm các yếu tố riêng lẻ, không cộng trực tiếp.",
      strengths: [{ title: "Vị trí", explanation: "Mặt tiền.", evidence_source: "listing" }],
      weaknesses: [{ title: "Pháp lý", explanation: "Tín hiệu pháp lý từ nội dung tin, cần kiểm chứng.", evidence_source: "listing" }],
    },
    factor_analysis: [
      { factor: "Giá", score: 72, label: "Tốt", explanation: "Dựa trên giá chào bán.", evidence_source: "calculated" },
    ],
    price_analysis: {
      available: true,
      asking_price: 5500000000,
      price_per_m2: 68750000,
      reference_available: false,
      reference_median: null,
      difference_percent: null,
      explanation: "Chưa đủ dữ liệu tham chiếu để so sánh giá khu vực.",
    },
    warnings: [
      {
        severity: "medium",
        title: "Xác minh pháp lý",
        explanation: "Nên kiểm tra thêm sổ và quy hoạch.",
        requires_verification: true,
        evidence_source: "listing",
      },
    ],
    next_steps: [{ priority: "high", title: "Xem sổ gốc", reason: "Xác minh pháp lý." }],
    limitations: ["Dữ liệu hiện tại có hạn chế."],
  };
}

async function main() {
  console.log("\n== Evidence pack (chỉ data thật) ==");

  await check("price_per_m2 tính tay, thiếu số -> null", () => {
    assert.equal(calcPricePerM2(5500000000, 80), 68750000);
    assert.equal(calcPricePerM2(null, 80), null);
    assert.equal(calcPricePerM2(5500000000, null), null);
    assert.equal(calcPricePerM2(0, 80), null);
    assert.equal(calcPricePerM2(5500000000, 0), null);
  });

  await check("evidence không bịa reference/comparables", () => {
    const e = sampleEvidence();
    assert.equal(e.price_intelligence.available, false);
    assert.equal(e.price_intelligence.median_asking_price_per_m2, null);
    assert.deepEqual(e.price_intelligence.comparables, []);
    assert.equal(e.property.price_per_m2, 68750000);
    assert.equal(e.scoring.overall_score, e.scoring.overall_score);
    assert.equal(e.metadata.analysis_version, "pro-v1");
  });

  await check("red flags chỉ từ tín hiệu thật trong text", () => {
    const e = sampleEvidence();
    // Text mẫu không có tranh chấp/quy hoạch/ngập -> không được bịa red flag đó
    const texts = e.detected_signals.red_flags.map((r) => r.signal).join(" ");
    assert.ok(!texts.includes("tranh chấp"));
    assert.ok(!texts.includes("quy hoạch"));
  });

  await check("missing fields phát hiện đúng chỗ trống", () => {
    const e = sampleEvidence();
    // Mẫu có đủ giá/diện tích/phòng/khu vực -> missing rỗng
    assert.deepEqual(e.detected_signals.missing_fields, []);
    const e2 = buildEvidencePack({
      result: analyzeListing("Bán nhà đẹp giá tốt liên hệ xem nhà"),
      dealType: "binh_thuong",
      scoringVersion: "jev-v1",
      analysisVersion: "pro-v1",
    });
    assert.ok(e2.detected_signals.missing_fields.length >= 3);
  });

  console.log("\n== Schema validation ==");

  await check("JSON hợp lệ -> parse được", () => {
    const p = parseProAnalysis(JSON.stringify(sampleAnalysis()));
    assert.ok(p);
    assert.equal(p!.summary.headline, "Tin 72/100 điểm");
  });

  await check("JSON hỏng -> null (để retry/fallback)", () => {
    assert.equal(parseProAnalysis("{khong phai json"), null);
    assert.equal(parseProAnalysis("[1,2,3]"), null);
  });

  await check("thiếu headline -> null", () => {
    const bad = { ...sampleAnalysis(), summary: { headline: "", text: "x", confidence: "low" } };
    assert.equal(parseProAnalysis(JSON.stringify(bad)), null);
  });

  await check("bóc code fence nếu model lỡ bọc markdown", () => {
    const p = parseProAnalysis("```json\n" + JSON.stringify(sampleAnalysis()) + "\n```");
    assert.ok(p);
  });

  await check("reference bịa bị ép false khi không có median", () => {
    const bad = sampleAnalysis();
    bad.price_analysis.reference_available = true;
    bad.price_analysis.reference_median = null;
    const p = parseProAnalysis(JSON.stringify(bad));
    assert.ok(p);
    assert.equal(p!.price_analysis.reference_available, false);
    assert.equal(p!.price_analysis.difference_percent, null);
  });

  console.log("\n== Hallucination guard ==");

  await check("analysis sạch -> pass", () => {
    const g = guardProAnalysis(sampleEvidence(), sampleAnalysis());
    assert.ok(g.ok, g.reasons.join("; "));
  });

  await check("giá/m² sai backend -> reject", () => {
    const bad = sampleAnalysis();
    bad.price_analysis.price_per_m2 = 99999999;
    const g = guardProAnalysis(sampleEvidence(), bad);
    assert.ok(!g.ok);
    assert.ok(g.reasons.some((r) => r.includes("price_per_m2")));
  });

  await check("khai reference khi evidence không có -> reject", () => {
    const bad = sampleAnalysis();
    bad.price_analysis.reference_available = true;
    bad.price_analysis.reference_median = 60000000;
    bad.price_analysis.difference_percent = 5;
    const g = guardProAnalysis(sampleEvidence(), bad);
    assert.ok(!g.ok);
  });

  await check("claim pháp lý đã xác minh -> reject", () => {
    const bad = sampleAnalysis();
    bad.warnings = [
      {
        severity: "high",
        title: "OK",
        explanation: "Pháp lý đã được xác minh, cứ mua.",
        requires_verification: false,
        evidence_source: "listing",
      },
    ];
    const g = guardProAnalysis(sampleEvidence(), bad);
    assert.ok(!g.ok);
  });

  await check("lời khuyên chắc nịch -> reject", () => {
    const bad = sampleAnalysis();
    bad.summary.text = "Bạn nên mua. Chắc chắn sinh lời.";
    const g = guardProAnalysis(sampleEvidence(), bad);
    assert.ok(!g.ok);
  });

  console.log("\n== Fallback (không gọi AI) ==");

  await check("fallback không có reference, confidence low", () => {
    const f = buildFallbackAnalysis(sampleEvidence());
    assert.equal(f.summary.confidence, "low");
    assert.equal(f.price_analysis.reference_available, false);
    assert.equal(f.price_analysis.reference_median, null);
    assert.ok(f.limitations.length > 0);
    assert.ok(f.next_steps.some((n) => n.priority === "high"));
  });

  await check("fallback vẫn có 3 điểm đáng chú ý DETERMINISTIC (Pro không bị rỗng)", () => {
    const f = buildFallbackAnalysis(sampleEvidence());
    assert.equal(f.highlights.length, 3);
    assert.ok(f.highlights.some((h) => h.type === "positive"), "phải có điểm tích cực từ contributions");
    assert.ok(f.highlights.some((h) => h.type === "neutral"), "phải có điểm giá/m² tính tay");
    // KHÔNG bịa điểm "cần lưu ý" khi evidence không có tín hiệu xấu
    const e = sampleEvidence();
    const hasBadSignal =
      e.scoring.contributions.some((c) => c.delta < 0) || e.detected_signals.red_flags.length > 0;
    const hasWarning = f.highlights.some((h) => h.type === "warning");
    if (!hasBadSignal) {
      assert.equal(hasWarning, false, "không được bịa cảnh báo khi dữ liệu không có rủi ro");
    }
    // Mọi highlight phải có evidence_source hợp lệ
    for (const h of f.highlights) {
      assert.ok(["scoring", "calculated", "missing", "listing_text"].includes(h.evidence_source));
      assert.ok(h.title.length > 0 && h.explanation.length > 0);
    }
  });

  await check("listing có tín hiệu xấu -> fallback vẫn hiện điểm cần lưu ý", () => {
    const riskyText = "Bán nhà hẻm nhỏ 40m2 giá 2 tỷ, quy hoạch treo, tranh chấp đất, giấy tay";
    const e = buildEvidencePack({
      price: 2000000000,
      area: 40,
      bedrooms: 2,
      region: "Bình Dương",
      listingText: riskyText,
      result: analyzeListing(riskyText),
      dealType: "rui_ro_phap_ly",
      scoringVersion: "jev-v1",
      analysisVersion: "pro-v1",
    });
    const f = buildFallbackAnalysis(e);
    assert.equal(f.highlights.length, 3);
    assert.ok(f.highlights.some((h) => h.type === "warning"), "phải có cảnh báo");
  });

  await check("điểm giá/m² của fallback đúng số backend, không phải AI tự tính", () => {
    const f = buildFallbackAnalysis(sampleEvidence());
    const ppm2 = f.highlights.find((h) => h.type === "neutral");
    assert.ok(ppm2);
    assert.ok(ppm2!.title.includes("68.750.000"), `title=${ppm2!.title}`);
  });

  await check("fallback thiếu giá/diện tích -> nói thẳng, không bịa số", () => {
    const e = buildEvidencePack({
      result: analyzeListing("Bán nhà đẹp giá tốt liên hệ xem"),
      dealType: "binh_thuong",
      scoringVersion: "jev-v1",
      analysisVersion: "pro-v1",
    });
    const f = buildFallbackAnalysis(e);
    assert.equal(f.price_analysis.available, false);
    const ppm2 = f.highlights.find((h) => h.type === "warning");
    assert.ok(ppm2, "phải cảnh báo thay vì hiện số bịa");
    assert.equal(f.highlights.filter((h) => h.type === "neutral").length, 0);
  });

  await check("ngôn ngữ fallback không vô tình dính cụm cấm của guard", () => {
    const f = buildFallbackAnalysis(sampleEvidence());
    const all = JSON.stringify(f).toLowerCase();
    for (const bad of ["bạn nên mua", "chắc chắn sinh lời", "roi cao", "pháp lý đã được xác minh"]) {
      assert.ok(!all.includes(bad), `fallback chứa cụm cấm: ${bad}`);
    }
  });

  await check("chưa có OPENROUTER_API_KEY -> fallback ngay, không gọi mạng", async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const t0 = Date.now();
      const out = await generateProAnalysis(sampleEvidence());
      assert.ok(out.fromFallback);
      assert.equal(out.fallbackReason, "no_api_key");
      assert.ok(Date.now() - t0 < 5000, "fallback phải nhanh, không chờ mạng");
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
