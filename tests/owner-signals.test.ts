// Owner/Broker signal tool (PHASE 4) — dấu hiệu trong NỘI DUNG TIN.
//
// Trọng tâm bảo vệ:
// - Tool phân tích CÂU CHỮ, không xác minh danh tính. Mọi nhãn nói về "tin".
// - "Chưa đủ dữ liệu" phải là kết quả THƯỜNG GẶP, không phải ngoại lệ.
// - Lời tự khai ("chính chủ", "miễn trung gian") là dấu hiệu YẾU, không quyết định.
// - Thuần máy: không fetch, không DB, không tra cứu SĐT.
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  MAX_LISTING_LENGTH,
  MIN_LISTING_LENGTH,
  classifyOwnerSignals,
  countIndependentSignals,
  type OwnerSignalResult,
} from "../lib/owner-signals/classify.ts";
import {
  ALL_SIGNALS,
  BROKER_SIGNALS,
  OWNER_SIGNALS,
  SIGNAL_BY_ID,
  signalsForSide,
  type SignalDefinition,
} from "../lib/owner-signals/signals.ts";import {
  countPhrase,
  findPhrase,
  hasClauseBoundary,
  isNegated,
  normalizeListing,
  normalizeWithMap,
  precededByAny,
  squeezeWhitespace,
} from "../lib/owner-signals/normalize.ts";
import {
  CLASSIFICATION_LABEL,
  CONFLICT_NOTE,
  EVIDENCE_HEADING_BROKER,
  EVIDENCE_HEADING_CONFLICT,
  EVIDENCE_HEADING_EMPTY,
  EVIDENCE_HEADING_OWNER,
  EVIDENCE_LEVEL_LABEL,
  FORBIDDEN_OWNER_CLAIMS,
  LEVEL_EXPLANATION,
  LIMITATION_LIST,
  LIMITATION_PRIMARY,
  LIMITATION_SELF_CLAIM,
  NEGATION_MARKERS,
  NEGATION_ONLY_CLAIMS,
  VERIFY_QUESTIONS,
} from "../lib/owner-signals/wording.ts";

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

const CLIENT_SRC = "components/owner-signals/owner-signal-client.tsx";
const PAGE_SRC = "app/tools/tin-chinh-chu-hay-moi-gioi/page.tsx";
const LIB_DIR = "lib/owner-signals";

function classify(text: string): OwnerSignalResult {
  const r = classifyOwnerSignals(text);
  assert.ok(r, `phải phân tích được: ${text.slice(0, 40)}`);
  return r;
}

/** Mọi chuỗi mà kết quả sinh ra cho người dùng đọc. */
function resultStrings(r: OwnerSignalResult): string[] {
  return [
    CLASSIFICATION_LABEL[r.classification],
    EVIDENCE_LEVEL_LABEL[r.evidenceLevel],
    LEVEL_EXPLANATION[r.evidenceLevel],
    r.why,
    ...LIMITATION_LIST,
    ...r.questions,
    ...r.brokerSignals.flatMap((s) => [s.label, s.means, s.quote]),
    ...r.ownerSignals.flatMap((s) => [s.label, s.means, s.quote]),
  ];
}

/**
 * Quét claim bị cấm trên output sinh ra cho người dùng.
 *
 * Hai tầng:
 *  1. FORBIDDEN_OWNER_CLAIMS — cấm tuyệt đối, mọi dạng.
 *  2. NEGATION_ONLY_CLAIMS — chỉ cho phép khi đang bị phủ định. Cần tầng này vì
 *     câu giới hạn bắt buộc ("...không xác minh danh tính người bán.") chứa cụm
 *     "xác minh danh tính" nhưng đang phủ nhận năng lực — đó là cách nói trung
 *     thực, không phải claim.
 */
function assertNoForbidden(strings: string[], where: string) {
  for (const text of strings) {
    const lower = text.toLowerCase();

    for (const claim of FORBIDDEN_OWNER_CLAIMS) {
      assert.equal(
        lower.includes(claim.toLowerCase()),
        false,
        `${where}: không được chứa "${claim}" — gặp trong: ${text}`,
      );
    }

    for (const claim of NEGATION_ONLY_CLAIMS) {
      const needle = claim.toLowerCase();
      let from = 0;
      for (;;) {
        const at = lower.indexOf(needle, from);
        if (at === -1) break;
        from = at + needle.length;

        const before = lower.slice(Math.max(0, at - 30), at);
        const negated = NEGATION_MARKERS.some((n) => before.includes(n));
        assert.ok(
          negated,
          `${where}: "${claim}" chỉ được nói dưới dạng phủ định — gặp khẳng định trong: ${text}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- A. BROKER STRONG

console.log("\n== A. broker-like: dấu hiệu mạnh ==");

check("\"nhận ký gửi nhà phố\" -> broker_like", () => {
  const r = classify("Nhận ký gửi nhà phố tại Đà Nẵng, giá tốt, liên hệ để biết thêm.");
  assert.equal(r.classification, "broker_like");
  assert.ok(r.brokerSignals.some((s) => s.id === "broker_receive_consignment"));
});

check("\"còn nhiều căn cùng khu vực\" -> broker_like", () => {
  const r = classify("Còn nhiều căn cùng khu vực Đà Nẵng, giá từ 3 tỷ, sổ hồng riêng từng căn.");
  assert.equal(r.classification, "broker_like");
  assert.ok(r.brokerSignals.some((s) => s.strength === "strong"));
});

check("\"công ty bất động sản...\" -> broker_like", () => {
  const r = classify("Công ty bất động sản chúng tôi cần bán nhà 80m2 tại Đà Nẵng, giá 5 tỷ.");
  assert.equal(r.classification, "broker_like");
  assert.ok(r.brokerSignals.some((s) => s.id === "broker_company"));
});

check("2 dấu hiệu MEDIUM độc lập -> broker_like", () => {
  const r = classify(
    "Bán nhà 70m2 Đà Nẵng. Hỗ trợ mua bán và tư vấn miễn phí cho khách thiện chí.",
  );
  assert.equal(r.classification, "broker_like");
  assert.ok(r.brokerSignals.filter((s) => s.strength === "medium").length >= 2);
});

// ---------------------------------------------------------------- B. WEAK BROKER

console.log("\n== B. broker yếu: KHÔNG quyết định ==");

check("\"em còn căn này\" -> insufficient", () => {
  const r = classify("Em còn căn này 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
});

check("\"gọi ngay\" -> insufficient", () => {
  const r = classify("Nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng, gọi ngay cho tôi để xem nhà.");
  assert.equal(r.classification, "insufficient");
});

check("đại từ một mình KHÔNG BAO GIỜ là broker", () => {
  for (const t of [
    "Bên em bán nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng hẻm xe hơi.",
    "Chúng tôi bán nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng hẻm xe hơi.",
  ]) {
    const r = classify(t);
    assert.equal(r.classification, "insufficient", t);
  }
});

check("chỉ 1 dấu hiệu MEDIUM -> insufficient", () => {
  const r = classify("Bán nhà 70m2 Đà Nẵng, hỗ trợ mua bán, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
});

// ---------------------------------------------------------------- C. OWNER MEDIUM

console.log("\n== C. owner-like: cần >= 2 dấu hiệu MEDIUM ==");

check("\"gia đình cần bán nhà đang ở\" (2 MEDIUM) -> owner_like", () => {
  const r = classify("Gia đình cần bán nhà đang ở 90m2 tại Đà Nẵng, giá 4 tỷ, sổ hồng riêng.");
  assert.equal(r.classification, "owner_like");
  assert.ok(r.ownerSignals.filter((s) => s.strength === "medium").length >= 2);
});

check("2 MEDIUM owner độc lập khác -> owner_like", () => {
  const r = classify("Tôi cần bán nhà 90m2 Đà Nẵng giá 4 tỷ, nhà đang ở, sổ hồng riêng.");
  assert.equal(r.classification, "owner_like");
});

check("1 MEDIUM owner -> insufficient", () => {
  const r = classify("Bán nhà 70m2 Đà Nẵng, nhà đang ở, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
});

// ---------------------------------------------------------------- D. WEAK OWNER

console.log("\n== D. owner yếu: lời tự khai KHÔNG quyết định ==");

check("\"chính chủ bán\" -> insufficient", () => {
  const r = classify("Chính chủ bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, hẻm xe hơi.");
  assert.equal(r.classification, "insufficient");
  assert.ok(r.ownerSignals.some((s) => s.id === "owner_self_claim" && s.strength === "weak"));
});

check("\"miễn trung gian\" -> insufficient", () => {
  const r = classify("Bán nhà 70m2 Đà Nẵng giá 3.5 tỷ, miễn trung gian, sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
});

check("\"không tiếp môi giới\" -> insufficient", () => {
  const r = classify("Bán nhà 70m2 Đà Nẵng 3.5 tỷ, không tiếp môi giới, sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
});

check("\"sổ tên tôi\" / \"đứng tên sổ\" -> insufficient", () => {
  const r = classify("Bán nhà 70m2 Đà Nẵng 3.5 tỷ, sổ tên tôi, đứng tên sổ rõ ràng.");
  assert.equal(r.classification, "insufficient");
});

check("nhiều lời tự khai cộng lại VẪN insufficient", () => {
  // Lặp lại lời tự khai không tạo thêm bằng chứng độc lập.
  const r = classify(
    "Chính chủ bán, chính chủ đứng tên, miễn trung gian, không tiếp môi giới, sổ tên tôi, nhà 70m2 Đà Nẵng 3.5 tỷ.",
  );
  assert.equal(r.classification, "insufficient");
});

// ---------------------------------------------------------------- E. CONFLICT

console.log("\n== E. mâu thuẫn -> insufficient, hiện cả hai nhóm ==");

check("owner MEDIUM + broker STRONG -> insufficient", () => {
  const r = classify("Gia đình cần bán nhà đang ở, đồng thời nhận ký gửi nhà phố khu vực Đà Nẵng.");
  assert.equal(r.classification, "insufficient");
  assert.equal(r.conflicting, true);
  assert.ok(r.brokerSignals.length > 0, "phải hiện nhóm broker");
  assert.ok(r.ownerSignals.length > 0, "phải hiện nhóm owner");
});

check("2 MEDIUM broker + 2 MEDIUM owner -> insufficient (không net thành số)", () => {
  const r = classify(
    "Chúng tôi nhận ký gửi và hỗ trợ mua bán. Gia đình cần bán nhà đang ở 90m2 giá 4 tỷ.",
  );
  assert.equal(r.classification, "insufficient");
  assert.equal(r.conflicting, true);
});

check("khi mâu thuẫn, KHÔNG nghiêng về bên nào", () => {
  const r = classify("Nhà tôi cần bán 70m2 Đà Nẵng 3.5 tỷ, còn nhiều căn cùng khu vực.");
  assert.equal(r.classification, "insufficient");
  assert.equal(r.conflicting, true);
});

check("khi mâu thuẫn, MỖI nhóm giữ tiêu đề riêng của mình", () => {
  // Bug thật đã gặp: đổi tiêu đề nhóm broker thành "Hai hướng dấu hiệu cùng xuất
  // hiện" khiến nhóm broker mất nhãn, người đọc không biết nhóm đó là gì.
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(
    src.includes("showBroker && <SignalGroup heading={EVIDENCE_HEADING_BROKER}"),
    "nhóm broker phải luôn dùng tiêu đề broker, không đổi theo trạng thái mâu thuẫn",
  );
  assert.ok(
    src.includes("showOwner && <SignalGroup heading={EVIDENCE_HEADING_OWNER}"),
    "nhóm owner phải luôn dùng tiêu đề owner",
  );
  // Thông báo mâu thuẫn vẫn phải hiện, nhưng ở dạng ghi chú riêng.
  assert.ok(src.includes("CONFLICT_NOTE"), "phải hiện ghi chú mâu thuẫn");
});

check("tiêu đề hai nhóm khác nhau và không phán danh tính", () => {
  assert.notEqual(EVIDENCE_HEADING_BROKER, EVIDENCE_HEADING_OWNER);
  for (const h of [
    EVIDENCE_HEADING_BROKER,
    EVIDENCE_HEADING_OWNER,
    EVIDENCE_HEADING_CONFLICT,
    EVIDENCE_HEADING_EMPTY,
  ]) {
    assert.equal(h.toLowerCase().includes("người đăng là"), false, `tiêu đề phán danh tính: ${h}`);
  }
});

// ---------------------------------------------------------------- F. GENERIC

console.log("\n== F. tin mô tả thông thường -> insufficient ==");

check("chỉ mô tả tài sản -> insufficient", () => {
  const r = classify("Bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, hẻm xe hơi, gần chợ.");
  assert.equal(r.classification, "insufficient");
  assert.equal(r.brokerSignals.length, 0);
  assert.equal(r.ownerSignals.length, 0);
});

check("insufficient là kết quả THƯỜNG GẶP, không phải ngoại lệ", () => {
  // Bộ mẫu đa dạng: đa số phải rơi vào insufficient.
  const samples = [
    "Bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, hẻm xe hơi, gần chợ.",
    "Chính chủ bán nhà 70m2 Đà Nẵng 3.5 tỷ sổ hồng riêng hẻm xe hơi.",
    "Bán đất 100m2 Hòa Hải Đà Nẵng giá 2.8 tỷ sổ đỏ thổ cư 100%.",
    "Cần bán căn hộ 65m2 view biển Mỹ Khê giá 3.2 tỷ đã có sổ.",
    "Bán nhà 4 tầng 80m2 mặt tiền đường Nguyễn Văn Linh giá 9 tỷ sổ hồng.",
    "Bán nhà 70m2 Đà Nẵng, miễn trung gian, giá 3.5 tỷ, sổ hồng riêng.",
    "Em còn căn 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng hẻm xe hơi.",
  ];
  const insufficient = samples.filter((s) => classify(s).classification === "insufficient").length;
  assert.ok(
    insufficient >= 5,
    `phải đa số là insufficient, chỉ ${insufficient}/${samples.length}`,
  );
});

// ---------------------------------------------------------------- G. ADVERSARIAL

console.log("\n== G. đối kháng ==");

check("\"chính chủ 100%\" KHÔNG tạo verified owner", () => {
  const r = classify("Chính chủ 100% bán nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng hẻm xe hơi.");
  assert.equal(r.classification, "insufficient");
  assert.notEqual(r.classification, "owner_like");
});

check("broker sao chép câu chữ chủ nhà -> KHÔNG tự tin owner_like", () => {
  // "chính chủ" (weak) + "nhà tôi cần bán" (medium) = chỉ 1 medium -> insufficient.
  const r = classify("Chính chủ bán, nhà tôi cần bán 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
});

check("chủ nhà thật nhưng viết như môi giới -> không kết luận owner", () => {
  // Giới hạn đã biết: nội dung giống broker thì tool nói broker_like.
  // Test này ghi nhận hành vi, KHÔNG khẳng định danh tính.
  const r = classify("Nhận ký gửi nhà phố, nhà tôi cần bán 70m2 Đà Nẵng 3.5 tỷ sổ hồng riêng.");
  assert.equal(r.classification, "insufficient");
  assert.equal(r.conflicting, true);
});

check("tool KHÔNG BAO GIỜ trả về khẳng định danh tính", () => {
  const all = [
    "Chính chủ 100% bán nhà 70m2 Đà Nẵng giá 3.5 tỷ.",
    "Nhận ký gửi nhà phố Đà Nẵng, giá tốt.",
    "Gia đình cần bán nhà đang ở 90m2 giá 4 tỷ.",
    "Bán nhà 70m2 Đà Nẵng 3.5 tỷ sổ hồng riêng.",
  ];
  for (const t of all) {
    const r = classify(t);
    assert.ok(
      ["broker_like", "owner_like", "insufficient"].includes(r.classification),
      `classification lạ: ${r.classification}`,
    );
    // Nhãn phải nói về "tin", không nói "người đăng là".
    const label = CLASSIFICATION_LABEL[r.classification];
    assert.equal(label.includes("người đăng là"), false, `nhãn phán người: ${label}`);
  }
});

// ---------------------------------------------------------------- H. DETERMINISM

console.log("\n== H. xác định (deterministic) ==");

check("cùng input hai lần -> deepEqual", () => {
  for (const t of [
    "Nhận ký gửi nhà phố tại Đà Nẵng, giá tốt.",
    "Chính chủ bán nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.",
    "Gia đình cần bán nhà đang ở 90m2 Đà Nẵng giá 4 tỷ.",
  ]) {
    assert.deepEqual(classifyOwnerSignals(t), classifyOwnerSignals(t), t);
  }
});

// ---------------------------------------------------------------- I. PRIVACY

console.log("\n== I. riêng tư / mạng ==");

check("stub global fetch -> 0 lần gọi", () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("không được gọi mạng");
  }) as unknown as typeof fetch;
  try {
    classify("Nhận ký gửi nhà phố tại Đà Nẵng, giá tốt, liên hệ ngay.");
    classify("Chính chủ bán nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.");
    assert.equal(calls, 0, `đã gọi mạng ${calls} lần`);
  } finally {
    globalThis.fetch = real;
  }
});

check("lib owner-signals KHÔNG chứa Supabase / DB / API client", () => {
  for (const f of ["normalize.ts", "signals.ts", "classify.ts", "wording.ts"]) {
    const src = readFileSync(`${LIB_DIR}/${f}`, "utf8");
    for (const bad of [
      "supabase",
      "@supabase",
      "adminClient",
      "createClient",
      ".from(",
      ".insert(",
      "fetch(",
      "await ",
      "/api/",
    ]) {
      assert.equal(src.includes(bad), false, `${f} không được chứa "${bad}"`);
    }
  }
});

check("lib owner-signals KHÔNG tra cứu số điện thoại", () => {
  for (const f of ["normalize.ts", "signals.ts", "classify.ts", "wording.ts"]) {
    const src = readFileSync(`${LIB_DIR}/${f}`, "utf8").toLowerCase();
    for (const bad of ["extractphone", "normalizephone", "phone", "sđt", "so dien thoai"]) {
      assert.equal(src.includes(bad), false, `${f} không được chứa "${bad}"`);
    }
  }
});

check("component KHÔNG fetch, KHÔNG dùng sessionStorage/localStorage", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.equal(src.includes("fetch("), false, "component không được fetch");
  assert.equal(src.includes("sessionStorage"), false);
  assert.equal(src.includes("localStorage"), false);
});

check("trang không gọi endpoint nào", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.equal(src.includes("/api/"), false, "page không được tham chiếu API");
  assert.equal(src.includes("fetch("), false);
});

// ---------------------------------------------------------------- J. COPY

console.log("\n== J. guard câu chữ ==");

check("mọi chuỗi kết quả sạch claim bị cấm", () => {
  for (const t of [
    "Nhận ký gửi nhà phố tại Đà Nẵng, giá tốt.",
    "Chính chủ bán nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.",
    "Gia đình cần bán nhà đang ở 90m2 Đà Nẵng giá 4 tỷ.",
    "Bán nhà 70m2 Đà Nẵng 3.5 tỷ sổ hồng riêng hẻm xe hơi.",
    "Nhà tôi cần bán 70m2 Đà Nẵng 3.5 tỷ, còn nhiều căn cùng khu vực.",
  ]) {
    assertNoForbidden(resultStrings(classify(t)), `result(${t.slice(0, 18)})`);
  }
});

check("KHÔNG có phần trăm hay xác suất trong output", () => {
  for (const t of [
    "Nhận ký gửi nhà phố tại Đà Nẵng, giá tốt.",
    "Gia đình cần bán nhà đang ở 90m2 Đà Nẵng giá 4 tỷ.",
    "Bán nhà 70m2 Đà Nẵng 3.5 tỷ sổ hồng riêng.",
  ]) {
    const strings = resultStrings(classify(t));
    for (const s of strings) {
      assert.equal(/\d+\s*%/.test(s), false, `có phần trăm: ${s}`);
      assert.equal(s.toLowerCase().includes("xác suất"), false, `có xác suất: ${s}`);
      assert.equal(s.toLowerCase().includes("độ chính xác"), false, `có độ chính xác: ${s}`);
    }
  }
});

check("nhãn kết quả dùng wording về TIN, không về danh tính", () => {
  assert.equal(CLASSIFICATION_LABEL.broker_like, "CÓ NHIỀU DẤU HIỆU GIỐNG TIN MÔI GIỚI");
  assert.equal(CLASSIFICATION_LABEL.owner_like, "CÓ MỘT SỐ DẤU HIỆU GIỐNG TIN NGƯỜI BÁN TRỰC TIẾP");
  assert.equal(CLASSIFICATION_LABEL.insufficient, "CHƯA ĐỦ DỮ LIỆU");
  // Không được dùng "chính chủ có khả năng cao" làm nhãn chính.
  for (const label of Object.values(CLASSIFICATION_LABEL)) {
    assert.equal(label.toLowerCase().includes("chính chủ có khả năng cao"), false);
    assert.equal(label.toLowerCase().includes("người đăng là"), false);
    assert.equal(label.toLowerCase().includes("đây là"), false);
  }
});

check("mức độ dấu hiệu dùng chữ, không dùng số", () => {
  assert.equal(EVIDENCE_LEVEL_LABEL.many, "KHÁ NHIỀU DẤU HIỆU");
  assert.equal(EVIDENCE_LEVEL_LABEL.some, "MỘT VÀI DẤU HIỆU");
  assert.equal(EVIDENCE_LEVEL_LABEL.insufficient, "CHƯA ĐỦ DỮ LIỆU");
});

check("limitation copy bắt buộc tồn tại và đúng nội dung", () => {
  assert.equal(
    LIMITATION_PRIMARY,
    "CheckBDS chỉ phân tích dấu hiệu trong nội dung tin đăng, không xác minh danh tính người bán.",
  );
  assert.match(LIMITATION_SELF_CLAIM, /chính chủ/);
  assert.match(LIMITATION_SELF_CLAIM, /không đủ để xác minh/);
  assert.ok(LIMITATION_LIST.length >= 3);
  assertNoForbidden([...LIMITATION_LIST], "limitation");
});

check("mọi kết quả đều kèm câu hỏi tự xác minh", () => {
  for (const t of [
    "Nhận ký gửi nhà phố Đà Nẵng.",
    "Gia đình cần bán nhà đang ở 90m2 Đà Nẵng giá 4 tỷ.",
    "Bán nhà 70m2 Đà Nẵng 3.5 tỷ sổ hồng riêng hẻm xe hơi.",
  ]) {
    const r = classify(t);
    assert.ok(r.questions.length >= 3 && r.questions.length <= 5, `phải 3-5 câu, có ${r.questions.length}`);
    assert.equal(r.questions.length, VERIFY_QUESTIONS.length);
  }
});

check("câu hỏi xác minh hỏi về người đứng tên sổ", () => {
  assert.ok(VERIFY_QUESTIONS.some((q) => q.includes("đứng tên trên sổ")));
  assert.ok(VERIFY_QUESTIONS.some((q) => q.includes("gặp trực tiếp")));
  assertNoForbidden([...VERIFY_QUESTIONS], "questions");
});

check("empty evidence KHÔNG được nói là an toàn", () => {
  const r = classify("Bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, hẻm xe hơi.");
  assert.equal(r.classification, "insufficient");
  const strings = resultStrings(r).join(" ").toLowerCase();
  for (const bad of ["an toàn", "đã xác minh", "đáng tin", "sạch"]) {
    assert.equal(strings.includes(bad), false, `không được nói "${bad}" khi không có dấu hiệu`);
  }
});

// ---------------------------------------------------------------- K. EMPTY / SHORT

console.log("\n== K. tin trống / quá ngắn ==");

check("quá ngắn -> null, KHÔNG ép phân loại", () => {
  assert.equal(classifyOwnerSignals("nhà đẹp"), null);
  assert.equal(classifyOwnerSignals(""), null);
  assert.equal(classifyOwnerSignals("   "), null);
  assert.equal(classifyOwnerSignals("chính chủ"), null);
  assert.equal(classifyOwnerSignals("x".repeat(MIN_LISTING_LENGTH - 1)), null);
  assert.ok(classifyOwnerSignals("x".repeat(MIN_LISTING_LENGTH)));
});

check("trần độ dài khớp chuẩn sản phẩm (1000)", () => {
  assert.equal(MAX_LISTING_LENGTH, 1000);
});

// ---------------------------------------------------------------- normalize

console.log("\n== chuẩn hoá & trích dẫn ==");

check("bỏ dấu: 'chính chủ' và 'chinh chu' khớp cùng mẫu", () => {
  assert.equal(normalizeListing("Chính Chủ"), "chinh chu");
  assert.equal(normalizeListing("chinh chu"), "chinh chu");
  assert.equal(normalizeListing("Đứng Tên Sổ"), "dung ten so");
});

check("trích dẫn giữ NGUYÊN VĂN câu chữ người đăng", () => {
  const original = "Chính chủ bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ.";
  const listing = normalizeWithMap(original);
  const m = findPhrase(original, listing, "chính chủ");
  assert.ok(m);
  assert.equal(m.quote, "Chính chủ", "phải giữ dấu, không trả bản bỏ dấu");
});

check("trích dẫn đúng cả khi văn bản ở dạng tách rời (decomposed)", () => {
  // "Chính" dạng tách rời: C h i n h + U+0301 (dấu sắc rời)
  const decomposed = "Chi\u0301nh chu\u0309 bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ.";
  const listing = normalizeWithMap(decomposed);
  const m = findPhrase(decomposed, listing, "chính chủ");
  assert.ok(m, "phải khớp được ở dạng tách rời");
  assert.equal(m.quote, "Chi\u0301nh chu\u0309", "phải cắt đúng trên bản gốc");
});

check("biến thể viết liền 'chinhchu' được nhận", () => {
  const r = classify("chinhchu ban nha 70m2 Da Nang gia 3.5 ty so hong rieng hem xe hoi");
  assert.ok(r.ownerSignals.some((s) => s.id === "owner_self_claim"));
});

check("'chúng tôi cần bán' KHÔNG tính là dấu hiệu chủ nhà", () => {
  // "chúng tôi cần bán" chứa "tôi cần bán" — phải chặn để không nhận nhầm tổ chức.
  const r = classify("Công ty bất động sản chúng tôi cần bán nhà 80m2 tại Đà Nẵng, giá 5 tỷ.");
  assert.equal(
    r.ownerSignals.some((s) => s.id === "owner_my_house"),
    false,
    "không được nhận 'tôi cần bán' khi chủ thể là 'chúng tôi'",
  );
});

check("countPhrase đếm đúng số lần nhắc", () => {
  const listing = normalizeWithMap("chính chủ, chính chủ, chính chủ bán nhà");
  assert.equal(countPhrase(listing, "chính chủ"), 3);
});

check("squeezeWhitespace gộp dấu câu thành khoảng trắng", () => {
  assert.equal(squeezeWhitespace("chinh chu, khong tiep moi gioi"), "chinh chu khong tiep moi gioi");
});

// ---------------------------------------------------------------- signal catalog

console.log("\n== danh mục dấu hiệu ==");

check("mọi dấu hiệu có id duy nhất", () => {
  const ids = ALL_SIGNALS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "id phải duy nhất");
});

check("mọi dấu hiệu có đủ label + means + pattern", () => {
  for (const s of ALL_SIGNALS) {
    assert.ok(s.label.length > 0, `${s.id} thiếu label`);
    assert.ok(s.means.length > 0, `${s.id} thiếu means`);
    assert.ok(s.patterns.length > 0, `${s.id} thiếu pattern`);
    for (const p of s.patterns) {
      // Pattern viết bằng tiếng Việt có dấu (dễ đọc, dễ bảo trì) và được
      // chuẩn hoá lúc so khớp trong findPhrase — nên phải kiểm tra vòng tròn:
      // chuẩn hoá pattern rồi tìm lại chính nó trong bản chuẩn hoá của nó.
      const n = normalizeListing(p);
      assert.ok(n.length > 0, `${s.id}: pattern "${p}" chuẩn hoá ra rỗng`);
      assert.equal(
        normalizeListing(n),
        n,
        `${s.id}: pattern "${p}" phải ổn định qua chuẩn hoá (idempotent)`,
      );
    }
  }
});

check("SIGNAL_BY_ID khớp danh mục", () => {
  for (const s of ALL_SIGNALS) {
    assert.equal(SIGNAL_BY_ID.get(s.id), s);
  }
  assert.equal(signalsForSide("broker"), BROKER_SIGNALS);
  assert.equal(signalsForSide("owner"), OWNER_SIGNALS);
});

check("mọi 'means' mô tả nội dung, không phán danh tính", () => {
  for (const s of ALL_SIGNALS) {
    const m = s.means.toLowerCase();
    for (const bad of ["người đăng là", "đây là môi giới", "đây là chính chủ", "đã xác minh"]) {
      assert.equal(m.includes(bad), false, `${s.id}: means phán danh tính — "${bad}"`);
    }
  }
});

check("'means' không chứa claim bị cấm", () => {
  for (const s of ALL_SIGNALS) {
    assertNoForbidden([s.label, s.means], `signal ${s.id}`);
  }
});

// ---------------------------------------------------------------- REMEDIATION

console.log("\n== REMEDIATION BLOCKER-1: phủ định ==");

check("B1-1 \"Tôi không nhận ký gửi, miễn trung gian...\" -> KHÔNG broker_like", () => {
  const r = classify("Tôi không nhận ký gửi, miễn trung gian, bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
  assert.equal(r.brokerSignals.some((s) => s.id === "broker_receive_consignment"), false);
});

check("B1-2 \"Chủ nhà không nhận ký gửi qua môi giới...\" -> KHÔNG broker_like", () => {
  const r = classify("Chủ nhà không nhận ký gửi qua môi giới, bán trực tiếp, nhà 70m2 Đà Nẵng.");
  assert.notEqual(r.classification, "broker_like");
});

check("B1-3 \"Không qua sàn giao dịch\" -> KHÔNG broker_like", () => {
  const r = classify("Không qua sàn giao dịch, bán trực tiếp, nhà 70m2 tại Đà Nẵng giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
});

check("B1-4 \"Không phải công ty bất động sản\" -> KHÔNG broker_like", () => {
  const r = classify("Không phải công ty bất động sản, gia đình tự bán nhà 70m2 Đà Nẵng.");
  assert.notEqual(r.classification, "broker_like");
  assert.equal(r.brokerSignals.some((s) => s.id === "broker_company"), false);
});

check("B1-5 \"Nhà không có kho hàng\" -> KHÔNG broker_like", () => {
  const r = classify("Nhà không có kho hàng, sổ hồng riêng, 70m2 tại Đà Nẵng giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
});

check("B1-6 phủ định ở MỆNH ĐỀ KHÁC không giết dấu hiệu thật", () => {
  // "không" thuộc vế trước (dấu chấm chặn), nên "nhận ký gửi" vẫn phải tính.
  const r = classify("Không cần sửa chữa. Nhận ký gửi nhà phố khu vực này, giá tốt.");
  assert.equal(r.classification, "broker_like");
  assert.ok(r.brokerSignals.some((s) => s.id === "broker_receive_consignment"));
});

check("cụm bị phủ định KHÔNG vào bằng chứng và KHÔNG hiện trích dẫn", () => {
  const r = classify("Tôi không nhận ký gửi, bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ sổ hồng riêng.");
  const all = [...r.brokerSignals, ...r.ownerSignals];
  assert.equal(
    all.some((s) => s.quote.includes("nhận ký gửi")),
    false,
    "không được hiện 'nhận ký gửi' làm bằng chứng khi nó bị phủ định",
  );
});

check("\"miễn phí xem nhà\" KHÔNG bị coi là phủ định", () => {
  // "miễn" ở đây là dịch vụ miễn phí, không phải loại trừ -> dấu hiệu vẫn tính.
  const r = classify("Bán nhà 70m2 Đà Nẵng. Miễn phí xem nhà, hỗ trợ mua bán cho khách thiện chí.");
  assert.ok(
    r.brokerSignals.some((s) => s.id === "broker_free_service"),
    "miễn phí xem nhà phải vẫn là dấu hiệu dịch vụ",
  );
});

check("\"chữa\" (sửa chữa) KHÔNG bị nhầm thành \"chưa\"", () => {
  // "chữa" và "chưa" bỏ dấu đều thành "chua" nhưng khác nghĩa hoàn toàn.
  // Khi văn bản CÓ dấu, phải phân biệt được bằng chữ gốc.
  const withChua = "Nhà cần sửa chữa nhẹ, nhận ký gửi nhà phố tại Đà Nẵng giá tốt.";
  const l1 = normalizeWithMap(withChua);
  assert.equal(
    isNegated(withChua, l1, l1.normalized.indexOf("nhan ky gui")),
    false,
    "\"chữa\" không phải phủ định",
  );
  assert.ok(
    classify(withChua).brokerSignals.some((s) => s.id === "broker_receive_consignment"),
    "câu có \"sửa chữa\" vẫn phải nhận ra hoạt động nhận ký gửi",
  );

  // Còn "chưa" thật thì phải là phủ định.
  const withRealChua = "Tôi chưa nhận ký gửi nhà phố nào tại khu vực này.";
  const l2 = normalizeWithMap(withRealChua);
  assert.equal(
    isNegated(withRealChua, l2, l2.normalized.indexOf("nhan ky gui")),
    true,
    "\"chưa\" là phủ định",
  );
});

check("văn bản KHÔNG dấu: \"chua\" mặc định là phủ định (an toàn hơn)", () => {
  // Không dấu thì không phân biệt được "chưa" và "chữa". Chọn coi là phủ định
  // vì bỏ sót dấu hiệu chỉ ra "chưa đủ dữ liệu", còn nhận nhầm thì ra kết luận sai.
  const unaccented = "toi chua nhan ky gui nha pho";
  const l = normalizeWithMap(unaccented);
  assert.equal(isNegated(unaccented, l, l.normalized.indexOf("nhan ky gui")), true);
});

check("phủ định ở mệnh đề khác (qua dấu phẩy) không giết dấu hiệu", () => {
  // "không" thuộc vế "không cần sửa chữa" — cách cụm khớp cả dấu phẩy lẫn
  // nhiều token, nên không được phủ định "nhận ký gửi".
  const r = classify("Nhà không cần sửa chữa gì, nhận ký gửi nhà phố tại Đà Nẵng giá tốt.");
  assert.ok(
    r.brokerSignals.some((s) => s.id === "broker_receive_consignment"),
    "phủ định ở vế khác không được chặn dấu hiệu thật",
  );
});

console.log("\n== REMEDIATION BLOCKER-2: ngữ cảnh STRONG ==");

check("B2-7 \"gần chi nhánh ngân hàng\" -> KHÔNG broker_like", () => {
  const r = classify("Bán nhà gần chi nhánh ngân hàng, 70m2 tại Đà Nẵng, giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
});

check("B2-8 \"gần sàn giao dịch chứng khoán\" -> KHÔNG broker_like", () => {
  const r = classify("Bán nhà gần sàn giao dịch chứng khoán, 70m2 Đà Nẵng giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
});

check("B2-9 \"văn phòng giao dịch ngân hàng\" -> KHÔNG broker_like", () => {
  const r = classify("Nhà gần văn phòng giao dịch ngân hàng, 70m2 Đà Nẵng giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
});

check("B2-10 \"nhà có kho hàng phía sau\" -> KHÔNG broker_like", () => {
  const r = classify("Nhà có kho hàng phía sau, 70m2 tại Đà Nẵng, giá 3.5 tỷ sổ hồng riêng.");
  assert.notEqual(r.classification, "broker_like");
});

check("B2-11 \"gần kho hàng logistics\" -> KHÔNG broker_like", () => {
  const r = classify("Gần kho hàng logistics, nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.");
  assert.notEqual(r.classification, "broker_like");
});

check("B2-12 \"chỗ khách gửi xe miễn phí\" -> KHÔNG broker_like", () => {
  const r = classify("Có chỗ khách gửi xe miễn phí, nhà 70m2 Đà Nẵng giá 3.5 tỷ.");
  assert.notEqual(r.classification, "broker_like");
  assert.equal(r.brokerSignals.some((s) => s.id === "broker_customer_sent"), false);
});

check("STRONG không còn dùng token trần dễ nhầm", () => {
  const bare = ["chi nhánh", "sàn giao dịch", "văn phòng giao dịch", "kho hàng", "khách gửi", "công ty tnhh", "công ty cổ phần"];
  for (const s of BROKER_SIGNALS) {
    for (const p of s.patterns) {
      assert.equal(
        bare.includes(p),
        false,
        `${s.id}: pattern trần "${p}" quá dễ nhầm với địa danh/tiện ích`,
      );
    }
  }
});

console.log("\n== REMEDIATION: broker thật vẫn phải nhận ra ==");

check("R-13 \"Nhận ký gửi nhà phố\" -> broker_like", () => {
  assert.equal(classify("Nhận ký gửi nhà phố tại Đà Nẵng, giá tốt, liên hệ để biết thêm.").classification, "broker_like");
});

check("R-14 \"Khách gửi bán căn nhà\" -> broker_like", () => {
  assert.equal(classify("Khách gửi bán căn nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ sổ hồng riêng.").classification, "broker_like");
});

check("R-15 \"Công ty bất động sản nhận ký gửi\" -> broker_like", () => {
  assert.equal(classify("Công ty bất động sản nhận ký gửi nhà 80m2 tại Đà Nẵng, giá 5 tỷ.").classification, "broker_like");
});

check("R-16 \"Sàn bất động sản chuyên khu vực\" -> broker_like", () => {
  assert.equal(classify("Sàn bất động sản chuyên khu vực Đà Nẵng, nhiều căn giá tốt.").classification, "broker_like");
});

check("R-17 \"Có giỏ hàng nhiều căn\" -> broker_like", () => {
  assert.equal(classify("Có giỏ hàng nhiều căn tại Đà Nẵng, giá từ 3 tỷ, sổ hồng riêng.").classification, "broker_like");
});

console.log("\n== REMEDIATION SHOULD_FIX-1: exclusion ngữ cảnh trước ==");

check("SF1-18 \"Chúng tôi cần bán\" -> KHÔNG có owner_my_house", () => {
  const r = classify("Chúng tôi cần bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.ownerSignals.some((s) => s.id === "owner_my_house"), false);
});

check("SF1-19 \"Bên tôi cần bán\" -> KHÔNG có owner_my_house", () => {
  const r = classify("Bên tôi cần bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.ownerSignals.some((s) => s.id === "owner_my_house"), false);
});

check("SF1-20 \"Công ty tôi cần bán\" -> KHÔNG có owner_my_house", () => {
  const r = classify("Công ty tôi cần bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.ownerSignals.some((s) => s.id === "owner_my_house"), false);
});

check("SF1-21 \"Công ty chúng tôi cần bán\" -> KHÔNG có owner_my_house", () => {
  const r = classify("Công ty chúng tôi cần bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.ownerSignals.some((s) => s.id === "owner_my_house"), false);
});

check("\"tôi cần bán\" cá nhân THẬT vẫn phải nhận", () => {
  const r = classify("Tôi cần bán nhà 90m2 Đà Nẵng giá 4 tỷ, sổ hồng riêng, hẻm xe hơi.");
  assert.ok(r.ownerSignals.some((s) => s.id === "owner_my_house"));
});

check("exclusion khai ở dạng đã chuẩn hoá, không trộn dấu", () => {
  for (const s of ALL_SIGNALS) {
    for (const ex of s.excludeIfPrecededBy ?? []) {
      assert.equal(
        ex,
        normalizeListing(ex),
        `${s.id}: exclusion "${ex}" phải ở dạng đã bỏ dấu (so khớp chạy trên bản chuẩn hoá)`,
      );
    }
  }
});

check("precededByAny khớp theo ranh giới từ, không theo substring", () => {
  const l = normalizeWithMap("bên cạnh nhà tôi cần bán");
  // "bên" ở đây là "bên cạnh", không phải "bên tôi" -> không được chặn.
  const at = l.normalized.indexOf("toi can ban");
  assert.equal(precededByAny(l.normalized, at, ["ben"]), false);
});

console.log("\n== REMEDIATION SHOULD_FIX-2: bằng chứng chồng lấn ==");

check("SF2-22 \"nhà tôi đang ở\" -> 1 đơn vị MEDIUM độc lập", () => {
  const r = classify("Nhà tôi đang ở 90m2 tại Đà Nẵng, giá 4 tỷ, sổ hồng riêng.");
  assert.equal(countIndependentSignals(r.ownerSignals, "medium"), 1);
  assert.notEqual(r.classification, "owner_like", "một cụm lồng nhau không được tạo 2 phiếu");
});

check("SF2-23 \"Gia đình cần bán nhà đang ở\" -> 2 đơn vị độc lập (khác span)", () => {
  const r = classify("Gia đình cần bán nhà đang ở 90m2 tại Đà Nẵng, giá 4 tỷ, sổ hồng riêng.");
  assert.equal(countIndependentSignals(r.ownerSignals, "medium"), 2);
  assert.equal(r.classification, "owner_like");
});

check("SF2-24 hai sự việc ở hai câu khác nhau -> vẫn tính 2", () => {
  const r = classify(
    "Gia đình cần bán căn nhà này 90m2 Đà Nẵng. Hiện gia đình đang ở đây, giá 4 tỷ.",
  );
  assert.equal(countIndependentSignals(r.ownerSignals, "medium"), 2);
});

check("hiển thị cũng đã gộp: không show 2 cụm trùng nghĩa", () => {
  const r = classify("Nhà tôi đang ở 90m2 tại Đà Nẵng, giá 4 tỷ, sổ hồng riêng.");
  assert.equal(r.ownerSignals.length, 1, "chỉ hiện cụm cụ thể nhất");
  assert.equal(r.ownerSignals[0].id, "owner_living_here");
});

check("cụm chồng lấn giữ cụm dài hơn (cụ thể hơn)", () => {
  const r = classify("Nhà tôi đang ở 90m2 tại Đà Nẵng, giá 4 tỷ, sổ hồng riêng.");
  const s = r.ownerSignals[0];
  assert.ok(s.end - s.start > "nhà tôi".length, `phải giữ cụm dài hơn, được "${s.quote}"`);
});

check("mỗi dấu hiệu hiện ra có span hợp lệ", () => {
  const r = classify("Gia đình cần bán nhà đang ở 90m2 tại Đà Nẵng, giá 4 tỷ.");
  for (const s of [...r.brokerSignals, ...r.ownerSignals]) {
    assert.ok(Number.isInteger(s.start) && Number.isInteger(s.end), `${s.id} thiếu span`);
    assert.ok(s.end > s.start, `${s.id} span không hợp lệ`);
  }
});

// ---------------------------------------------------------------- route / scope

console.log("\n== route & phạm vi ==");

check("route page tồn tại + metadata + H1", () => {
  assert.ok(existsSync(PAGE_SRC), `${PAGE_SRC} phải tồn tại`);
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(src.includes("export const metadata"));
  assert.ok(src.includes("/tools/tin-chinh-chu-hay-moi-gioi"), "canonical đúng route");
  assert.ok(src.includes("Tin này là chính chủ hay môi giới?"), "H1 đúng");
  assert.ok(src.includes(LIMITATION_PRIMARY), "limitation phải có trên trang");
  assert.ok(src.includes("FAQPage"), "phải có structured data");
});

check("SEO title đúng yêu cầu", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(src.includes("Tin chính chủ hay môi giới? Kiểm tra dấu hiệu | CheckBDS"));
});

check("trang không hứa xác minh danh tính", () => {
  const src = readFileSync(PAGE_SRC, "utf8").toLowerCase();
  for (const bad of ["phát hiện chính chủ", "xác minh môi giới", "kiểm tra danh tính", "chính chủ 100%"]) {
    assert.equal(src.includes(bad), false, `trang không được hứa "${bad}"`);
  }
});

check("textarea + CTA có nhãn và trợ năng", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes("<textarea"));
  assert.ok(src.includes('htmlFor="owner-listing"'));
  assert.ok(src.includes('id="owner-listing"'));
  assert.ok(src.includes("aria-describedby"));
  assert.ok(src.includes("maxLength={MAX_LISTING_LENGTH}"));
  assert.ok(src.includes("aria-disabled"));
  assert.ok(src.includes("Phân tích dấu hiệu"), "CTA đúng yêu cầu");
});

check("CTA chính >= 48px", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  const heights = [...src.matchAll(/h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  assert.ok(heights.length >= 2);
  for (const h of heights) assert.ok(h >= 48, `nút ${h}px phải >= 48px`);
});

check("CTA chính KHÔNG dùng flex-1 trần trong cột", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  for (const m of src.matchAll(/className=\{`[^`]*`\}/g)) {
    const cls = m[0];
    if (!cls.includes("h-[52px]")) continue;
    assert.equal(/(^|\s)flex-1(\s|$)/.test(cls), false, `không được flex-1 trần: ${cls.slice(0, 100)}`);
  }
});

check("sitemap có route mới", () => {
  const src = readFileSync("app/sitemap.ts", "utf8");
  assert.ok(src.includes("/tools/tin-chinh-chu-hay-moi-gioi"));
});

check("analytics chỉ phát 1 event, không kèm PII", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  const events = [...src.matchAll(/trackEvent\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(events, ["owner_signal_preview"]);
  for (const m of src.matchAll(/trackEvent\([^)]*\)/g)) {
    const call = m[0];
    for (const bad of ["trimmed", "text", "quote", "phone", "email", "url"]) {
      assert.equal(call.toLowerCase().includes(bad), false, `event không được chứa ${bad}: ${call}`);
    }
  }
  const analytics = readFileSync("lib/analytics.ts", "utf8");
  assert.ok(analytics.includes('"owner_signal_preview"'), "FunnelEvent phải khai báo event");
});

// ---------------------------------------------------------------- Deal Grader firewall

console.log("\n== firewall Deal Grader (Phase 3 không bị đụng) ==");

check("KHÔNG có import chéo giữa owner-signals và deal-grader", () => {
  for (const f of ["normalize.ts", "signals.ts", "classify.ts", "wording.ts"]) {
    const src = readFileSync(`${LIB_DIR}/${f}`, "utf8");
    assert.equal(src.includes("deal-grader"), false, `${f} không được import deal-grader`);
    assert.equal(src.includes("dealGrader"), false, `${f} không được tham chiếu dealGrader`);
  }
  const client = readFileSync(CLIENT_SRC, "utf8");
  assert.equal(client.includes("deal-grader"), false, "component không được import deal-grader");
});

check("Deal Grader KHÔNG bị sửa: không có owner/broker trong DealGrade", () => {
  const src = readFileSync("lib/deal-grader/preview.ts", "utf8");
  assert.equal(src.includes("owner-signals"), false, "Deal Grader không được import owner-signals");
  assert.equal(src.includes("classifyOwnerSignals"), false);
  // Doctrine lock của Phase 3 vẫn nguyên.
  assert.ok(src.includes("FORBIDDEN_DEAL_CLAIMS"));
  assert.equal(src.includes("ownerSignals"), false, "DealGrade không được thêm field owner");
  assert.equal(src.includes("brokerSignals"), false, "DealGrade không được thêm field broker");
});

check("Deal Grader tests vẫn khẳng định không ship phân loại người đăng", () => {
  const src = readFileSync("tests/deal-grader.test.ts", "utf8");
  assert.ok(src.includes("signal keys KHÔNG có owner/broker"));
  assert.ok(src.includes("view-model KHÔNG có field phân loại người đăng"));
});

check("không tạo endpoint / migration / SQL cho Phase 4", () => {
  assert.equal(existsSync("app/api/owner-signals"), false, "không được tạo endpoint");
  assert.equal(existsSync("supabase/migrations"), true, "thư mục migrations chỉ được là của repo sẵn có");
  const files = readFileSync("package.json", "utf8");
  assert.ok(files.includes("tests/owner-signals.test.ts"), "test phải nối vào chuỗi npm test");
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
