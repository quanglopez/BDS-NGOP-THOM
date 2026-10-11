// Urgency Verification Checklist (PHASE 6) — dấu hiệu bán gấp trong câu chữ.
//
// Trọng tâm bảo vệ:
// - Tool phân tích CÂU CHỮ, không xác minh lý do bán hay tình trạng tài chính.
// - "Bán gấp" KHÔNG phải "deal tốt" và KHÔNG phải "người bán đang kẹt tiền thật".
// - Thuần máy: không fetch, không DB, không localStorage, không quota.
// - Trích dẫn là NGUYÊN VĂN từ input (giữ dấu và hoa/thường).
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  MAX_LISTING_LENGTH,
  MIN_LISTING_LENGTH,
  checkUrgency,
  type UrgencyCheckResult,
} from "../lib/urgency-check/classify.ts";
import {
  ALL_URGENCY_SIGNALS,
  DECIDING_SIGNALS,
  MEDIUM_SIGNALS,
  SIGNAL_BY_ID,
  STRONG_SIGNALS,
  WEAK_SIGNALS,
} from "../lib/urgency-check/signals.ts";
import {
  CHECKLIST,
  CONDITIONAL_QUESTIONS,
  FORBIDDEN_URGENCY_CLAIMS,
  LEVEL_LABEL,
  LIMITATION,
  NEGATION_MARKERS,
  NEGATION_ONLY_CLAIMS,
  PHYSICAL_CHECKS,
  TOPIC_ORDER,
  URGENCY_NOT_QUALITY,
  WATCH_FOR,
  contextNote,
} from "../lib/urgency-check/wording.ts";

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

const CLIENT_SRC = "components/urgency-check/urgency-check-client.tsx";
const PAGE_SRC = "app/tools/kiem-tra-dau-hieu-ban-gap/page.tsx";
const LIB_DIR = "lib/urgency-check";

function run(text: string, ctx?: { isNgop?: number | null; dealType?: string | null }): UrgencyCheckResult {
  const r = checkUrgency({ text, ...(ctx ?? {}) });
  assert.ok(r, `phải phân tích được: ${text.slice(0, 40)}`);
  return r;
}

/** Mọi chuỗi mà kết quả sinh ra cho người dùng đọc. */
function resultStrings(r: UrgencyCheckResult): string[] {
  return [
    r.levelLabel,
    r.explanation,
    r.limitation,
    URGENCY_NOT_QUALITY,
    ...r.evidence.flatMap((e) => [e.label, e.reason, e.quote]),
    ...r.questions,
    ...r.watchFor,
    ...r.physicalChecks,
    ...(r.contextNote ? [r.contextNote] : []),
  ];
}

/**
 * Quét claim bị cấm. Hai tầng:
 *  1. FORBIDDEN_URGENCY_CLAIMS — cấm tuyệt đối.
 *  2. NEGATION_ONLY_CLAIMS — chỉ cho phép khi đang bị phủ định. Cần tầng này vì
 *     câu giới hạn bắt buộc ("...không xác minh lý do bán...") chứa "xác minh"
 *     nhưng đang phủ nhận năng lực — đó là cách nói trung thực.
 */
function assertNoForbidden(strings: string[], where: string) {
  for (const text of strings) {
    const lower = text.toLowerCase();
    for (const claim of FORBIDDEN_URGENCY_CLAIMS) {
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
        assert.ok(
          NEGATION_MARKERS.some((n) => before.includes(n)),
          `${where}: "${claim}" chỉ được nói dưới dạng phủ định — gặp khẳng định: ${text}`,
        );
      }
    }
  }
}

// ------------------------------------------------------------- signals (28)

console.log("\n== signals: STRONG / MEDIUM / WEAK ==");

check("1. một STRONG -> verify_soon", () => {
  const r = run("Bán gấp nhà phố tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.level, "verify_soon");
  assert.equal(r.independentStrong, 1);
  assert.equal(r.evidence[0].quote, "Bán gấp");
});

check("2. một MEDIUM -> insufficient", () => {
  const r = run("Cần tiền nên bán căn hộ 70m2 tại Đà Nẵng giá 3 tỷ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.independentStrong, 0);
  assert.equal(r.independentMedium, 1);
});

check("3. hai MEDIUM độc lập -> verify_soon", () => {
  const r = run("Cần tiền, đã giảm giá căn hộ 70m2 Đà Nẵng còn 3 tỷ.");
  assert.equal(r.level, "verify_soon");
  assert.equal(r.independentMedium, 2);
});

check("4. chỉ WEAK -> insufficient và KHÔNG có bằng chứng", () => {
  const r = run("Siêu phẩm giá sốc, cơ hội vàng cho nhà đầu tư.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0, "weak không bao giờ hiện làm bằng chứng");
});

check("5. tin chung chung -> insufficient", () => {
  const r = run("Cần bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

console.log("\n== negation (dùng engine Phase 4) ==");

for (const [i, text] of [
  "Không bán gấp, nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.",
  "Không cần bán nhanh, nhà 70m2 Đà Nẵng giá 3.5 tỷ.",
  "Chưa cần bán, nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.",
  "Không cắt lỗ, nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.",
  "Không kẹt tiền, nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.",
].entries()) {
  check(`${6 + i}. phủ định: "${text.slice(0, 24)}..." -> insufficient`, () => {
    const r = run(text);
    assert.equal(r.level, "insufficient");
    assert.equal(r.evidence.length, 0, "cụm bị phủ định không được là bằng chứng");
  });
}

console.log("\n== boundaries / overlap (29) ==");

check("11. ranh giới mệnh đề: dấu chấm cắt phủ định", () => {
  const r = run("Không bán căn cũ. Bán gấp căn này.");
  assert.equal(r.level, "verify_soon");
  // Chỉ cụm thật sự dương tính được trích, không trích cụm bị phủ định.
  const quotes = r.evidence.map((e) => e.quote.toLowerCase());
  assert.deepEqual(quotes, ["bán gấp"], `chỉ được trích 'Bán gấp', gặp ${JSON.stringify(quotes)}`);
});

check("12. chồng lấn: 'cần tiền gấp' là MỘT đơn vị bằng chứng", () => {
  const r = run("Cần tiền gấp để xử lý việc gia đình, nhà 70m2 Đà Nẵng.");
  assert.equal(r.evidence.length, 1, `phải gộp thành 1, gặp ${r.evidence.length}`);
  assert.equal(r.independentStrong, 1);
  assert.equal(r.independentMedium, 0, "không được tính thêm MEDIUM 'cần tiền' bên trong");
  assert.equal(r.evidence[0].quote, "Cần tiền gấp");
});

check("12b. không hồi sinh: cụm ngắn trong vùng bị phủ định", () => {
  const r = run("Không cần tiền gấp, nhà 70m2 Đà Nẵng giá 3.5 tỷ sổ hồng riêng.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("12c. STRONG thắng MEDIUM khi chồng lấn", () => {
  const r = run("Bán gấp căn hộ 70m2 Đà Nẵng, giá 3 tỷ, sổ hồng riêng.");
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].tier, "strong");
});

// ------------------------------------------------------------- evidence (30)

console.log("\n== evidence mapping (30) ==");

check("13. trích dẫn NGUYÊN VĂN, giữ nguyên dấu", () => {
  const r = run("Bán gấp nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ.");
  assert.equal(r.evidence[0].quote, "Bán gấp");
});

check("14. giữ nguyên chữ HOA", () => {
  const r = run("BÁN GẤP nhà phố Đà Nẵng giá 3 tỷ sổ hồng riêng.");
  assert.equal(r.evidence[0].quote, "BÁN GẤP", "phải giữ đúng casing người dùng gõ");
});

check("15. giữ nguyên dấu khi tin không dấu một phần", () => {
  const r = run("Bán Gấp nhà 70m2 Đà Nẵng giá 3 tỷ sổ hồng riêng.");
  assert.equal(r.evidence[0].quote, "Bán Gấp");
});

check("16. Unicode tách rời (NFD) vẫn cắt đúng trích dẫn", () => {
  // "Bán" ở dạng tách rời: B a + U+0301 n
  const decomposed = "Ba\u0301n gấp nhà 70m2 Đà Nẵng giá 3 tỷ sổ hồng riêng.";
  const r = run(decomposed);
  assert.equal(r.level, "verify_soon");
  assert.equal(r.evidence[0].quote, "Ba\u0301n gấp", "phải cắt đúng trên bản gốc");
});

check("17. span hợp lệ và khớp với vị trí trích dẫn", () => {
  const text = "Nhà 70m2 Đà Nẵng, bán gấp, giá 3 tỷ, sổ hồng riêng.";
  const r = run(text);
  const e = r.evidence[0];
  assert.ok(Number.isInteger(e.start) && Number.isInteger(e.end));
  assert.ok(e.end > e.start);
  assert.equal(text.slice(e.start, e.end), e.quote, "span phải trỏ đúng cụm trong bản gốc");
});

check("18. nhắc lại nhiều lần -> một đơn vị bằng chứng cho mỗi vị trí", () => {
  const r = run("Bán gấp nhà 70m2 Đà Nẵng. Bán gấp vì chuyển công tác, giá 3 tỷ.");
  // Hai vị trí khác nhau, cùng định nghĩa -> gộp theo định nghĩa (1 evidence).
  assert.equal(r.evidence.length, 1, "cùng định nghĩa chỉ tính 1 lần");
  assert.equal(r.independentStrong, 1);
});

check("19. không render cụm bị phủ định", () => {
  const r = run("Không bán gấp. Gia đình chưa cần bán.");
  const all = r.evidence.map((e) => e.quote.toLowerCase()).join(" ");
  assert.equal(all.includes("bán gấp"), false);
  assert.equal(all.includes("cần bán"), false);
});

// ------------------------------------------------------------- truthfulness (31)

console.log("\n== truthfulness (31) ==");

check("20. mọi chuỗi kết quả sạch claim bị cấm", () => {
  for (const t of [
    "Bán gấp nhà phố Đà Nẵng giá 3 tỷ.",
    "Ngộp ngân hàng, cần bán nhà 70m2 Đà Nẵng giá 3 tỷ.",
    "Cắt lỗ căn hộ 70m2 Đà Nẵng giá 2.8 tỷ.",
    "Cần tiền, đã giảm giá căn hộ Đà Nẵng còn 3 tỷ.",
    "Sang gấp hợp đồng thuê mặt bằng Đà Nẵng.",
    "Siêu phẩm giá sốc cơ hội vàng.",
    "Không bán gấp, nhà 70m2 Đà Nẵng giá 3.5 tỷ.",
  ]) {
    assertNoForbidden(resultStrings(run(t)), `result(${t.slice(0, 18)})`);
  }
});

check("21. KHÔNG có phần trăm hay xác suất trong output", () => {
  for (const t of ["Bán gấp nhà phố Đà Nẵng.", "Cần tiền, đã giảm giá căn hộ Đà Nẵng.", "Nhà 70m2 Đà Nẵng giá 3 tỷ."]) {
    for (const s of resultStrings(run(t))) {
      assert.equal(/\d+\s*%/.test(s), false, `có phần trăm: ${s}`);
      assert.equal(s.toLowerCase().includes("xác suất"), false, `có xác suất: ${s}`);
      assert.equal(s.toLowerCase().includes("khả năng"), false, `có khả năng: ${s}`);
    }
  }
});

check("22. không có điểm số urgency dạng 0-100", () => {
  const r = run("Bán gấp nhà phố Đà Nẵng giá 3 tỷ.");
  // Kết quả chỉ có hai mức, không có trường điểm.
  assert.equal("score" in r, false, "không được có trường score");
  assert.equal("urgencyScore" in r, false);
  assert.equal(r.level === "verify_soon" || r.level === "insufficient", true);
});

check("23. nhãn đúng hợp đồng", () => {
  assert.equal(LEVEL_LABEL.verify_soon, "DẤU HIỆU CẦN XÁC MINH SỚM");
  assert.equal(LEVEL_LABEL.insufficient, "CHƯA CÓ ĐỦ DỮ LIỆU VỀ MỨC ĐỘ GẤP");
});

check("24. limitation bắt buộc có trong MỌI kết quả", () => {
  assert.equal(
    LIMITATION,
    "CheckBDS chỉ phân tích câu chữ trong tin đăng, không xác minh lý do bán hay tình trạng tài chính của người bán.",
  );
  for (const t of ["Bán gấp nhà phố Đà Nẵng giá 3 tỷ.", "Nhà 70m2 Đà Nẵng giá 3 tỷ sổ hồng riêng."]) {
    assert.equal(run(t).limitation, LIMITATION);
  }
});

check("25. nói rõ bán gấp KHÔNG phải deal tốt", () => {
  assert.match(URGENCY_NOT_QUALITY, /không có nghĩa là giá tốt/i);
  assertNoForbidden([URGENCY_NOT_QUALITY], "urgency-not-quality");
});

check("26. ngữ cảnh KHÔNG đổi level", () => {
  const base = run("Bán gấp nhà 70m2 Đà Nẵng giá 3 tỷ.");
  const withCtx = run("Bán gấp nhà 70m2 Đà Nẵng giá 3 tỷ.", { isNgop: 95, dealType: "ngop_ngon" });
  assert.equal(base.level, withCtx.level, "isNgop/dealType không được đổi mức kết luận");
  assert.equal(base.independentStrong, withCtx.independentStrong);
  assert.equal(base.independentMedium, withCtx.independentMedium);
  // Và cũng không đổi mức khi tin không có dấu hiệu.
  const none = run("Nhà 70m2 Đà Nẵng giá 3 tỷ sổ hồng riêng.");
  const noneCtx = run("Nhà 70m2 Đà Nẵng giá 3 tỷ sổ hồng riêng.", { isNgop: 90, dealType: "ngop_ngon" });
  assert.equal(none.level, noneCtx.level);
  assert.equal(none.level, "insufficient");
});

check("27. context note chỉ hiện khi có ngữ cảnh", () => {
  assert.equal(run("Bán gấp nhà 70m2 Đà Nẵng giá 3 tỷ.").contextNote, null);
  assert.equal(contextNote(), null);
  assert.equal(contextNote(null, null), null);
  const note = contextNote(80, null);
  assert.ok(note && note.includes("mức ngộp 80/100"));
  assert.match(note, /không phải xác minh/i);
  assertNoForbidden([note], "context note");
});

// ------------------------------------------------------------- checklist (15-17)

console.log("\n== checklist / watch-for / physical (15-18) ==");

check("28. checklist đúng 5 câu, đúng thứ tự", () => {
  assert.equal(CHECKLIST.length, 5);
  assert.equal(CHECKLIST[0], "Lý do cụ thể cần bán nhanh là gì?");
  assert.equal(CHECKLIST[4], "Nếu không bán được trong thời hạn đó thì điều gì xảy ra?");
  // Luôn hiển thị, kể cả khi không có bằng chứng.
  const r = run("Nhà 70m2 Đà Nẵng giá 3 tỷ sổ hồng riêng.");
  for (const c of CHECKLIST) assert.ok(r.questions.includes(c), `thiếu checklist: ${c}`);
});

check("29. câu hỏi có điều kiện đúng nhóm, không trùng", () => {
  const bank = run("Ngân hàng thanh lý nhà 70m2 Đà Nẵng giá 3 tỷ.");
  assert.ok(bank.questions.includes(CONDITIONAL_QUESTIONS.bank));

  const loss = run("Cắt lỗ căn hộ 70m2 Đà Nẵng giá 2.8 tỷ.");
  assert.ok(loss.questions.includes(CONDITIONAL_QUESTIONS.loss));

  const price = run("Cần tiền, đã giảm giá căn hộ Đà Nẵng còn 3 tỷ.");
  assert.ok(price.questions.includes(CONDITIONAL_QUESTIONS.price_cut));

  const transfer = run("Sang gấp hợp đồng thuê mặt bằng tại Đà Nẵng.");
  assert.ok(transfer.questions.includes(CONDITIONAL_QUESTIONS.transfer));

  // Không trùng câu.
  for (const r of [bank, loss, price, transfer]) {
    assert.equal(new Set(r.questions).size, r.questions.length, "câu hỏi không được trùng");
  }
});

check("30. nhiều dấu hiệu cùng nhóm -> chỉ 1 câu điều kiện", () => {
  const r = run("Ngộp ngân hàng thanh lý, cần tiền gấp, nhà 70m2 Đà Nẵng giá 3 tỷ.");
  const bankQs = r.questions.filter((q) => q === CONDITIONAL_QUESTIONS.bank);
  assert.equal(bankQs.length, 1, "cùng nhóm bank chỉ thêm 1 câu");
});

check("31. watch-for đúng concept, cách nói thận trọng", () => {
  assert.ok(WATCH_FOR.length >= 4);
  const joined = WATCH_FOR.join(" ").toLowerCase();
  assert.match(joined, /mốc thời gian/);
  assert.match(joined, /đổi lý do/);
  assert.match(joined, /đặt cọc trước/);
  assert.match(joined, /hậu quả nếu trễ/);
  // Không dùng từ buộc tội.
  for (const bad of ["lừa đảo", "scam", "gian dối", "bịp"]) {
    assert.equal(joined.includes(bad), false, `watch-for không được dùng "${bad}"`);
  }
});

check("32. physical checks rất ngắn và có bàn giao pháp lý", () => {
  assert.ok(PHYSICAL_CHECKS.length <= 4, "không lặp lại toàn bộ checklist pháp lý");
  const joined = PHYSICAL_CHECKS.join(" ").toLowerCase();
  assert.match(joined, /giấy tờ gốc/);
  assert.match(joined, /uỷ quyền/);
  assert.match(joined, /thế chấp|giải chấp/);
});

check("33. TOPIC_ORDER phủ hết topic dùng trong catalog", () => {
  const topics = new Set(DECIDING_SIGNALS.map((d) => d.topic));
  for (const t of topics) {
    assert.ok(TOPIC_ORDER.includes(t), `TOPIC_ORDER thiếu "${t}"`);
  }
});

// ------------------------------------------------------------- empty / short

console.log("\n== tin trống / quá ngắn ==");

check("34. quá ngắn -> null, không ép phân loại", () => {
  assert.equal(checkUrgency({ text: "nhà đẹp" }), null);
  assert.equal(checkUrgency({ text: "" }), null);
  assert.equal(checkUrgency({ text: "   " }), null);
  assert.equal(checkUrgency({ text: "x".repeat(MIN_LISTING_LENGTH - 1) }), null);
  assert.ok(checkUrgency({ text: "x".repeat(MIN_LISTING_LENGTH) }));
});

check("35. trần độ dài khớp chuẩn sản phẩm (1000)", () => {
  assert.equal(MAX_LISTING_LENGTH, 1000);
});

check("36. tất định: cùng input -> deepEqual", () => {
  for (const t of [
    "Bán gấp nhà phố Đà Nẵng giá 3 tỷ.",
    "Không bán gấp, nhà 70m2 Đà Nẵng giá 3.5 tỷ.",
    "Cần tiền, đã giảm giá căn hộ Đà Nẵng còn 3 tỷ.",
  ]) {
    assert.deepEqual(checkUrgency({ text: t }), checkUrgency({ text: t }), t);
  }
});

check("37. không sửa input", () => {
  const text = "Bán gấp nhà phố Đà Nẵng giá 3 tỷ.";
  const before = text;
  checkUrgency({ text });
  assert.equal(text, before);
});

// ------------------------------------------------------------- catalog integrity

console.log("\n== danh mục dấu hiệu ==");

check("38. id duy nhất, đủ label/reason/pattern", () => {
  const ids = ALL_URGENCY_SIGNALS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "id phải duy nhất");
  for (const s of ALL_URGENCY_SIGNALS) {
    assert.ok(s.label.length > 0, `${s.id} thiếu label`);
    assert.ok(s.reason.length > 0, `${s.id} thiếu reason`);
    assert.ok(s.patterns.length > 0, `${s.id} thiếu pattern`);
  }
});

check("39. SIGNAL_BY_ID khớp danh mục", () => {
  for (const s of ALL_URGENCY_SIGNALS) assert.equal(SIGNAL_BY_ID.get(s.id), s);
});

check("40. STRONG/MEDIUM/WEAK đúng mức đã khai", () => {
  for (const s of STRONG_SIGNALS) assert.equal(s.tier, "strong");
  for (const s of MEDIUM_SIGNALS) assert.equal(s.tier, "medium");
  for (const s of WEAK_SIGNALS) assert.equal(s.tier, "weak");
  assert.equal(DECIDING_SIGNALS.some((s) => s.tier === "weak"), false, "weak không được quyết định");
});

check("41. reason không phán người bán", () => {
  for (const s of ALL_URGENCY_SIGNALS) {
    const m = s.reason.toLowerCase();
    for (const bad of ["chủ đang", "người bán đang kẹt", "đang ngộp thật", "đã xác minh"]) {
      assert.equal(m.includes(bad), false, `${s.id}: reason phán người bán — "${bad}"`);
    }
  }
});

check("42. reason/label sạch claim bị cấm", () => {
  for (const s of ALL_URGENCY_SIGNALS) {
    assertNoForbidden([s.label, s.reason], `signal ${s.id}`);
  }
});

// ------------------------------------------------------------- privacy / static

/** Bỏ dòng comment để không quét nhầm phần mô tả ràng buộc. */
function codeOnly(file: string): string {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
}

/** Rút các cặp q/a trong FAQS của page. */
function faqPairs(): Array<{ q: string; a: string }> {
  const src = readFileSync(PAGE_SRC, "utf8");
  const out: Array<{ q: string; a: string }> = [];
  const re = /q:\s*"((?:[^"\\]|\\.)*)",\s*\n\s*a:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({
      q: m[1].replace(/\\"/g, '"'),
      a: m[2].replace(/\\"/g, '"'),
    });
  }
  return out;
}

console.log("\n== privacy / static firewall (26-27) ==");

check("43. lib/urgency-check KHÔNG có mạng/DB/storage", () => {
  for (const f of ["signals.ts", "classify.ts", "wording.ts"]) {
    const code = codeOnly(`${LIB_DIR}/${f}`);
    for (const bad of ["fetch(", "/api/", "supabase", "createClient", "adminClient", "await ", "localStorage", "sessionStorage"]) {
      assert.equal(code.includes(bad), false, `${f} không được chứa "${bad}" trong code`);
    }
  }
});

check("44. client KHÔNG fetch, KHÔNG storage", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  for (const bad of ["fetch(", "localStorage", "sessionStorage", "XMLHttpRequest"]) {
    assert.equal(src.includes(bad), false, `client không được chứa "${bad}"`);
  }
});

check("45. KHÔNG import từ Phase 5 / Deal Grader / API", () => {
  for (const f of [CLIENT_SRC, `${LIB_DIR}/classify.ts`, `${LIB_DIR}/signals.ts`, `${LIB_DIR}/wording.ts`, PAGE_SRC]) {
    const src = codeOnly(f);
    for (const bad of ["lib/call-queue", "dashboard/bulk-check", "lib/deal-grader", "components/deal-grader", "app/api", "lib/scoring"]) {
      assert.equal(src.includes(bad), false, `${f} không được import "${bad}"`);
    }
  }
});

check("46. chỉ dùng normalize helper của Phase 4, không import gì khác của Phase 4", () => {
  const src = codeOnly(`${LIB_DIR}/classify.ts`);
  const phase4Imports = [...src.matchAll(/from "@\/lib\/owner-signals\/([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(phase4Imports)], ["normalize"], `chỉ được import normalize, gặp ${phase4Imports}`);
  for (const bad of ["owner-signals/classify", "owner-signals/signals", "owner-signals/wording"]) {
    assert.equal(src.includes(bad), false, `không được import ${bad}`);
  }
});

check("47. KHÔNG dùng lại NGOP_KEYWORDS / scoring cũ", () => {
  for (const f of [`${LIB_DIR}/signals.ts`, `${LIB_DIR}/classify.ts`]) {
    const src = codeOnly(f);
    assert.equal(src.includes("NGOP_KEYWORDS"), false, `${f} không được dùng NGOP_KEYWORDS`);
    assert.equal(src.includes("analyzeListing"), false, `${f} không được dùng analyzeListing`);
  }
});

// ------------------------------------------------------------- SEO / UI static (32)

console.log("\n== SEO / UI static (32) ==");

check("48. route tồn tại + H1 EXACT", () => {
  assert.ok(existsSync(PAGE_SRC), `${PAGE_SRC} phải tồn tại`);
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(src.includes("Kiểm tra dấu hiệu bán gấp trong tin BĐS"), "H1 phải đúng");
});

check("49. title + canonical EXACT", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  assert.ok(src.includes("Kiểm tra dấu hiệu bán gấp trong tin BĐS | CheckBDS"), "title phải đúng");
  assert.ok(src.includes('canonical: "/tools/kiem-tra-dau-hieu-ban-gap"'), "canonical phải đúng");
});

check("50. FAQ dùng CÙNG một mảng cho hiển thị và JSON-LD", () => {
  const src = readFileSync(PAGE_SRC, "utf8");
  const decls = [...src.matchAll(/const FAQS = \[/g)].length;
  assert.equal(decls, 1, `chỉ được khai báo FAQS một lần, gặp ${decls}`);
  assert.ok(src.includes("{FAQS.map"), "phải map FAQS để render hiển thị");
  assert.ok(src.includes("mainEntity: FAQS.map"), "JSON-LD phải dùng cùng mảng FAQS");
  assert.ok(src.includes("FAQPage"), "phải có structured data");
});

check("51. SEO phrase cấm 'thật hay giả' không xuất hiện", () => {
  const src = readFileSync(PAGE_SRC, "utf8").toLowerCase();
  assert.equal(src.includes("thật hay giả"), false, "không được dùng cụm này trong SEO");
});

check("52. FAQ có 5 câu, đủ chủ đề yêu cầu", () => {
  const pairs = faqPairs();
  assert.equal(pairs.length, 5, `phải đúng 5 câu FAQ, gặp ${pairs.length}`);
  const qs = pairs.map((p) => p.q);
  assert.ok(qs.some((q) => q.includes("xác minh lý do bán")), "thiếu FAQ xác minh lý do bán");
  assert.ok(qs.some((q) => q.includes("deal tốt")), "thiếu FAQ bán gấp có phải deal tốt");
  assert.ok(qs.some((q) => q.includes("Nên hỏi gì")), "thiếu FAQ nên hỏi gì");
  assert.ok(qs.some((q) => q.includes("lưu")), "thiếu FAQ lưu nội dung tin");
  assert.ok(qs.some((q) => q.includes("thay thế kiểm tra pháp lý")), "thiếu FAQ thay thế pháp lý");
});

check("53. FAQ trả lời đúng: không xác minh, không phải deal tốt, chạy local", () => {
  const pairs = faqPairs();
  const answers = pairs.map((p) => p.a).join("\n");
  assert.match(answers, /Không\. Công cụ chỉ đọc các cụm từ/);
  assert.match(answers, /Không\. Bán gấp chỉ là cách viết trong tin/);
  assert.match(answers, /toàn bộ phân tích chạy trong trình duyệt/i);
  // Câu trả lời không được khẳng định điều tool không làm được.
  assertNoForbidden(pairs.flatMap((p) => [p.q, p.a]), "FAQ");
});

check("54. CTA >= 48px và có nhãn đúng", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes("Kiểm tra dấu hiệu"), "CTA đúng nhãn");
  const heights = [...src.matchAll(/h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  assert.ok(heights.length >= 1);
  for (const h of heights) assert.ok(h >= 48, `nút ${h}px phải >= 48px`);
  assert.ok(src.includes("h-12"), "CTA phụ dùng 48px");
});

check("55. CTA không dùng flex-1 trần trong cột", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  for (const m of src.matchAll(/className=\{`[^`]*`\}/g)) {
    const cls = m[0];
    if (!cls.includes("h-[52px]")) continue;
    assert.equal(/(^|\s)flex-1(\s|$)/.test(cls), false, `không được flex-1 trần: ${cls.slice(0, 100)}`);
  }
});

check("56. textarea có nhãn, aria, trần ký tự", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes("<textarea"));
  assert.ok(src.includes('htmlFor="urgency-listing"'));
  assert.ok(src.includes('id="urgency-listing"'));
  assert.ok(src.includes("aria-describedby"));
  assert.ok(src.includes("maxLength={MAX_LISTING_LENGTH}"));
  assert.ok(src.includes("aria-disabled"));
});

check("57. sitemap có route mới, priority 0.8, monthly", () => {
  const src = readFileSync("app/sitemap.ts", "utf8");
  const line = src.split(/\r?\n/).find((l) => l.includes("/tools/kiem-tra-dau-hieu-ban-gap"));
  assert.ok(line, "sitemap phải có route");
  assert.ok(line.includes("monthly"), "changeFrequency phải là monthly");
  assert.ok(line.includes("0.8"), "priority phải là 0.8");
});

check("58. cross-tool CTA trỏ đúng route hiện có", () => {
  const w = readFileSync(`${LIB_DIR}/wording.ts`, "utf8");
  assert.ok(w.includes("/tools/kiem-tra-phap-ly-truoc-coc"), "handoff pháp lý đúng route");
  assert.ok(w.includes("/tools/cham-diem-tin-dang"), "handoff chấm điểm đúng route");
  // Không tự dựng route mới.
  assert.equal(w.includes("/tools/tin-chinh-chu"), false, "không tự thêm route owner/broker");
});

check("59. không có analytics trong Phase 6", () => {
  for (const f of [CLIENT_SRC, PAGE_SRC, `${LIB_DIR}/classify.ts`]) {
    const src = readFileSync(f, "utf8");
    assert.equal(src.includes("trackEvent"), false, `${f} không được gọi analytics`);
    assert.equal(src.includes("lib/analytics"), false, `${f} không được import analytics`);
  }
});

check("60. package.json có test chain cho urgency", () => {
  const pkg = readFileSync("package.json", "utf8");
  assert.ok(pkg.includes("tests/urgency-check.test.ts"), "test phải nối vào chuỗi npm test");
});

// ------------------------------------------- OMP remediation (B-1/B-2/S-1/S-2)

console.log("\n== OMP: phủ định bank / phát mãi / giải chấp / ngộp ==");

check("61. B-1 'Không bị ngân hàng siết nợ.' -> insufficient, 0 evidence", () => {
  const r = run("Không bị ngân hàng siết nợ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0, "'siết nợ' bị phủ định không được là bằng chứng");
});

check("62. B-1 'Không bị bank siết nợ.' -> insufficient, 0 evidence", () => {
  const r = run("Không bị bank siết nợ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("63. B-1 'Chưa bị ngân hàng siết nợ.' -> insufficient, 0 evidence", () => {
  const r = run("Chưa bị ngân hàng siết nợ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("64. B-1 'Chưa từng bị ngân hàng siết nợ.' -> insufficient, 0 evidence", () => {
  const r = run("Chưa từng bị ngân hàng siết nợ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("65. B-1 dương tính 'Ngân hàng siết nợ tài sản, cần xử lý gấp.' -> verify_soon", () => {
  const r = run("Ngân hàng siết nợ tài sản, cần xử lý gấp.");
  assert.equal(r.level, "verify_soon", "không được dập tắt 'siết nợ' dương tính");
  const e = r.evidence.find((x) => x.signalId === "bank_foreclosure");
  assert.ok(e, "phải còn bằng chứng 'siết nợ'");
  assert.equal(e.quote, "siết nợ");
});

check("66. B-1 dương tính 'Bị ngân hàng siết nợ nên cần bán nhanh.' -> verify_soon", () => {
  const r = run("Bị ngân hàng siết nợ nên cần bán nhanh.");
  assert.equal(r.level, "verify_soon");
  assert.ok(r.evidence.some((x) => x.signalId === "bank_foreclosure"));
});

check("67. B-2 'Phát mãi quà tặng kèm khi mua căn hộ.' -> insufficient, 0 evidence", () => {
  const r = run("Phát mãi quà tặng kèm khi mua căn hộ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0, "'phát mãi' trần không được là bằng chứng");
});

check("68. B-2 dương tính 'Ngân hàng phát mãi căn nhà để thu hồi nợ.' -> verify_soon", () => {
  const r = run("Ngân hàng phát mãi căn nhà để thu hồi nợ.");
  assert.equal(r.level, "verify_soon");
  const e = r.evidence.find((x) => x.signalId === "property_auction");
  assert.ok(e, "phải có bằng chứng phát mãi");
  assert.match(e.quote.toLowerCase(), /phát mãi/);
});

check("69. S-1 'Đã giải chấp xong, cần sang sổ nhanh.' -> insufficient, không bằng chứng giải chấp", () => {
  const r = run("Đã giải chấp xong, cần sang sổ nhanh.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.some((x) => x.signalId === "active_release"), false, "trạng thái đã hoàn tất không phải dấu hiệu");
  assert.equal(r.evidence.some((x) => /giải chấp/i.test(x.quote)), false);
});

check("70. S-1 dương tính 'Cần bán để giải chấp khoản vay ngân hàng.' -> verify_soon", () => {
  const r = run("Cần bán để giải chấp khoản vay ngân hàng.");
  assert.equal(r.level, "verify_soon");
  const e = r.evidence.find((x) => x.signalId === "active_release");
  assert.ok(e, "nhu cầu giải chấp còn đang có phải được nhận");
  assert.match(e.quote.toLowerCase(), /giải chấp/);
});

check("71. S-1 'Đã giải chấp xong, hồ sơ đầy đủ, cần sang tên.' -> insufficient, không bằng chứng giải chấp", () => {
  const r = run("Đã giải chấp xong, hồ sơ đầy đủ, cần sang tên.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.some((x) => x.signalId === "active_release"), false);
  assert.equal(r.evidence.some((x) => /giải chấp/i.test(x.quote)), false);
});

check("72. S-2 'Ngộp nước sau mưa lớn khiến tầng 1 bị ngập.' -> insufficient, 0 evidence", () => {
  const r = run("Ngộp nước sau mưa lớn khiến tầng 1 bị ngập.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0, "'ngộp' trần không được là bằng chứng");
});

check("73. S-2 dương tính 'Ngộp ngân hàng nên cần bán căn hộ.' -> verify_soon", () => {
  const r = run("Ngộp ngân hàng nên cần bán căn hộ.");
  assert.equal(r.level, "verify_soon");
  assert.ok(r.evidence.some((x) => x.signalId === "ngop"));
});

check("74. S-2 không dấu 'Ngop bank can ban gap can ho.' -> verify_soon", () => {
  const r = run("Ngop bank can ban gap can ho.");
  assert.equal(r.level, "verify_soon");
  assert.ok(r.evidence.some((x) => x.signalId === "ngop"), "'ngộp bank' phải khớp cả bản không dấu");
});

check("75. probe 'Nhà gần ngân hàng, cần bán căn hộ.' -> insufficient, 0 deciding evidence", () => {
  const r = run("Nhà gần ngân hàng, cần bán căn hộ.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("76. probe 'Thanh lý nội thất, cần bán nhà.' -> insufficient, 0 deciding evidence", () => {
  const r = run("Thanh lý nội thất, cần bán nhà.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("77. probe 'Giảm giá nội thất tặng kèm.' -> KHÔNG verify_soon, không claim distress", () => {
  const r = run("Giảm giá nội thất tặng kèm.");
  assert.equal(r.level, "insufficient", "1 MEDIUM không được nâng thành verify_soon");
  for (const e of r.evidence) {
    assert.equal(e.topic, "price_cut");
    assert.equal(
      /ngân hàng|siết nợ|phát mãi|ngộp|kẹt tiền|cắt lỗ/.test(`${e.label} ${e.reason}`.toLowerCase()),
      false,
      "bằng chứng giảm giá không được mang claim distress",
    );
  }
});

check("78. hồi quy dương 'Bán gấp nhà phố vì chuyển công tác.' -> verify_soon", () => {
  const r = run("Bán gấp nhà phố vì chuyển công tác.");
  assert.equal(r.level, "verify_soon");
});

check("79. hồi quy dương 'Cần tiền nên giảm giá căn hộ.' -> verify_soon (2 MEDIUM)", () => {
  const r = run("Cần tiền nên giảm giá căn hộ.");
  assert.equal(r.level, "verify_soon");
  assert.equal(r.independentMedium, 2);
});

check("80. hồi quy dương 'Ngân hàng thanh lý căn nhà để thu hồi nợ.' -> verify_soon", () => {
  const r = run("Ngân hàng thanh lý căn nhà để thu hồi nợ.");
  assert.equal(r.level, "verify_soon");
  assert.ok(r.evidence.some((x) => x.signalId === "bank_liquidation"));
});

check("81. phủ định 'Không bị ngân hàng thanh lý, không bị ngân hàng phát mãi.' -> insufficient, 0 evidence", () => {
  const r = run("Không bị ngân hàng thanh lý, không bị ngân hàng phát mãi.");
  assert.equal(r.level, "insufficient");
  assert.equal(r.evidence.length, 0);
});

check("82. catalog: không còn pattern trần bị cấm; siết nợ có chặn phủ định", () => {
  const banned = new Set(["phát mãi", "giải chấp", "ngộp", "ngop", "phat mai", "giai chap"]);
  for (const s of DECIDING_SIGNALS) {
    for (const p of s.patterns) {
      assert.equal(banned.has(p), false, `${s.id} không được giữ pattern trần "${p}"`);
    }
  }
  const fore = SIGNAL_BY_ID.get("bank_foreclosure");
  assert.ok(fore, "phải có định nghĩa bank_foreclosure");
  assert.ok(
    fore.excludeIfPrecededBy?.includes("khong bi ngan hang"),
    "siết nợ phải chặn tiền tố 'không bị ngân hàng' (dạng chuẩn hoá)",
  );
});

check("83. nhãn bank_foreclosure mô tả đúng cụm 'siết nợ'", () => {
  const e = run("Bị ngân hàng siết nợ nên cần bán nhanh.").evidence.find(
    (x) => x.signalId === "bank_foreclosure",
  );
  assert.ok(e);
  assert.match(e.label, /siết nợ/, "nhãn phải nêu đúng cụm khớp");
  assert.equal(/thanh lý|giải chấp|phát mãi/.test(e.label), false, "không được gộp nhãn chung cho cụm khác");
  assertNoForbidden([e.label, e.reason], "bank_foreclosure");
});

check("84. nhãn từng định nghĩa bank nêu đúng concept của cụm", () => {
  const liq = run("Ngân hàng thanh lý căn nhà để thu hồi nợ.").evidence.find(
    (x) => x.signalId === "bank_liquidation",
  );
  assert.ok(liq);
  assert.match(liq.label, /thanh lý/);
  const auc = run("Ngân hàng phát mãi căn nhà để thu hồi nợ.").evidence.find(
    (x) => x.signalId === "property_auction",
  );
  assert.ok(auc);
  assert.match(auc.label, /phát mãi/);
  const rel = run("Cần bán để giải chấp khoản vay ngân hàng.").evidence.find(
    (x) => x.signalId === "active_release",
  );
  assert.ok(rel);
  assert.match(rel.label, /giải chấp/);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
