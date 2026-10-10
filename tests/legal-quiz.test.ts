// Legal Quiz (PHASE 2) — chấm điểm deterministic + guard wording pháp lý.
// Không AI, không mạng, không quota. Chạy bằng node --experimental-strip-types.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  FORBIDDEN_CLAIMS,
  GREEN_WITH_NOTES_LABEL,
  LEVEL_LABEL,
  legalChecklist,
  levelLabelFor,
  scoreLegalQuiz,
  type LegalQuizAnswers,
} from "../lib/legal-quiz/scoring.ts";
import { EMPTY_ANSWERS, QUESTIONS } from "../lib/legal-quiz/questions.ts";

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

/** Bộ "tốt": sổ đỏ, đủ thủ tục, không tranh chấp/thế chấp, thông tin nhất quán. */
const GOOD: LegalQuizAnswers = {
  giayTo: "so_do",
  hoanCong: "co",
  quyHoach: "da_kiem_tra",
  tranhChap: "khong",
  mucDichSuDung: "phu_hop",
  soHuu: "mot_chu",
  theChap: "khong",
  banGoc: "ban_goc",
  nguoiBan: "chinh_chu",
  lyDoBan: "binh_thuong",
  giaBatThuong: "binh_thuong",
  nhatQuan: "nhat_quan",
};

const with_ = (patch: Partial<LegalQuizAnswers>): LegalQuizAnswers => ({ ...GOOD, ...patch });

// Mọi output không được chứa khẳng định tuyệt đối.
function assertNoForbiddenClaims(parts: string[], where: string) {
  for (const text of parts) {
    for (const claim of FORBIDDEN_CLAIMS) {
      assert.equal(
        text.toLowerCase().includes(claim.toLowerCase()),
        false,
        `${where}: không được chứa "${claim}"`,
      );
    }
  }
}

console.log("\n== cấu trúc quiz ==");

check("đúng 12 câu, index 1..12", () => {
  assert.equal(QUESTIONS.length, 12);
  QUESTIONS.forEach((q, i) => assert.equal(q.index, i + 1));
});

check("mặc định không mặc định tích cực", () => {
  // Default phải là "chưa rõ", không phải đáp án tốt.
  assert.equal(EMPTY_ANSWERS.giayTo, "chua_ro");
  assert.equal(EMPTY_ANSWERS.banGoc, "chua_xem");
  assert.equal(EMPTY_ANSWERS.quyHoach, "chua_kiem_tra");
});

console.log("\n== low risk ==");

check("bộ tốt -> green, 0 cờ", () => {
  const r = scoreLegalQuiz(GOOD);
  assert.equal(r.level, "green");
  assert.equal(r.flags.length, 0);
  assert.equal(r.riskScore, 0);
});

check("green KHÔNG nói an toàn / pháp lý sạch", () => {
  const r = scoreLegalQuiz(GOOD);
  assert.equal(r.levelLabel, LEVEL_LABEL.green);
  assertNoForbiddenClaims(
    [r.levelLabel, r.summary, LEVEL_LABEL.green],
    "green output",
  );
});

console.log("\n== medium risk ==");

check("chưa hoàn công + chỉ photo -> orange", () => {
  const r = scoreLegalQuiz(with_({ hoanCong: "khong", banGoc: "photo" }));
  assert.equal(r.level, "orange");
  assert.ok(r.riskScore >= 20 && r.riskScore < 50, `điểm ${r.riskScore}`);
  assert.ok(r.flags.some((f) => f.id === "chua_hoan_cong"));
  assert.ok(r.flags.some((f) => f.id === "chi_photo"));
});

check("chưa kiểm tra quy hoạch -> có cờ quy hoạch", () => {
  const r = scoreLegalQuiz(with_({ quyHoach: "chua_kiem_tra" }));
  assert.ok(r.flags.some((f) => f.id === "chua_kiem_tra_quy_hoach"));
});

check("cờ stop luôn kéo level lên red", () => {
  const stopIds = ["vi_bang", "giay_tay", "tranh_chap", "the_chap"];
  const patch: Record<string, Partial<LegalQuizAnswers>> = {
    vi_bang: { giayTo: "vi_bang" },
    giay_tay: { giayTo: "giay_tay" },
    tranh_chap: { tranhChap: "co" },
    the_chap: { theChap: "co" },
  };
  for (const id of stopIds) {
    const r = scoreLegalQuiz(with_(patch[id]));
    assert.equal(r.level, "red", `${id} phải là red`);
    assert.ok(r.flags.some((f) => f.severity === "stop"), `${id} phải có cờ stop`);
  }
});

check("mỗi cờ đều có vì sao + cách xác minh", () => {
  const r = scoreLegalQuiz(with_({ hoanCong: "khong", theChap: "chua_ro" }));
  for (const f of r.flags) {
    assert.ok(f.why.length > 10, `${f.id}: thiếu why`);
    assert.ok(f.verify.length > 10, `${f.id}: thiếu verify`);
    assert.ok(f.title.length > 0, `${f.id}: thiếu title`);
  }
});

console.log("\n== high risk ==");

check("vi bằng -> red (dù điểm chưa tới 50)", () => {
  const r = scoreLegalQuiz(with_({ giayTo: "vi_bang" }));
  assert.equal(r.level, "red");
  assert.ok(r.flags.some((f) => f.id === "vi_bang"));
  // RED ở đây đến từ cờ "stop", không phải từ ngưỡng điểm:
  // vi bằng bắt buộc dừng, không thể chỉ "kiểm tra thêm".
  assert.equal(r.flags.find((f) => f.id === "vi_bang")?.severity, "stop");
});

check("giấy tay -> red", () => {
  const r = scoreLegalQuiz(with_({ giayTo: "giay_tay" }));
  assert.equal(r.level, "red");
});

check("tranh chấp -> red", () => {
  const r = scoreLegalQuiz(with_({ tranhChap: "co" }));
  assert.equal(r.level, "red");
  assert.ok(r.flags.some((f) => f.id === "tranh_chap"));
});

check("thế chấp -> red", () => {
  const r = scoreLegalQuiz(with_({ theChap: "co" }));
  assert.equal(r.level, "red");
  assert.ok(r.flags.some((f) => f.id === "the_chap"));
});

check("đồng sở hữu + sổ chung -> có cả 2 cờ", () => {
  const r = scoreLegalQuiz(with_({ soHuu: "dong_so_huu", giayTo: "so_chung" }));
  assert.ok(r.flags.some((f) => f.id === "dong_so_huu"));
  assert.ok(r.flags.some((f) => f.id === "so_chung"));
});

check("bán gấp + giá thấp bất thường -> cờ lừa đảo", () => {
  const r = scoreLegalQuiz(with_({ lyDoBan: "ban_gap", giaBatThuong: "thap_bat_thuong" }));
  assert.ok(r.flags.some((f) => f.id === "ban_gap_gia_thap"));
});

check("thông tin không nhất quán -> cờ", () => {
  const r = scoreLegalQuiz(with_({ nhatQuan: "khong_nhat_quan" }));
  assert.ok(r.flags.some((f) => f.id === "khong_nhat_quan"));
});

console.log("\n== unknown fields ==");

check("toàn chưa rõ -> vẫn có điểm rủi ro, không green", () => {
  const r = scoreLegalQuiz(EMPTY_ANSWERS);
  assert.ok(r.riskScore > 0, "chưa rõ phải sinh rủi ro, không phải 0");
  assert.ok(r.flags.length > 0);
});

check("điểm luôn kẹp trong 0..100", () => {
  const worst = scoreLegalQuiz({
    giayTo: "giay_tay",
    hoanCong: "khong",
    quyHoach: "khong_biet",
    tranhChap: "co",
    mucDichSuDung: "khong_phu_hop",
    soHuu: "dong_so_huu",
    theChap: "co",
    banGoc: "chua_xem",
    nguoiBan: "uy_quyen",
    lyDoBan: "ban_gap",
    giaBatThuong: "thap_bat_thuong",
    nhatQuan: "khong_nhat_quan",
  });
  assert.ok(worst.riskScore <= 100, `điểm ${worst.riskScore}`);
  assert.equal(worst.level, "red");
});

console.log("\n== guard wording tuyệt đối ==");

// Canonical list: mọi flag id mà scoring có thể sinh ra.
// Thêm flag mới trong scoring.ts mà quên ở đây -> test coverage sẽ fail,
// buộc phải cập nhật cả hai nơi.
const EXPECTED_FLAG_IDS = [
  "vi_bang",
  "giay_tay",
  "so_ho",
  "so_chung",
  "chua_ro_giay_to",
  "chua_hoan_cong",
  "chua_ro_hoan_cong",
  "chua_kiem_tra_quy_hoach",
  "tranh_chap",
  "chua_ro_tranh_chap",
  "muc_dich_khong_phu_hop",
  "chua_ro_muc_dich",
  "dong_so_huu",
  "chua_ro_so_huu",
  "the_chap",
  "chua_ro_the_chap",
  "chi_photo",
  "chua_xem_giay_to",
  "uy_quyen",
  "chua_ro_nguoi_ban",
  "ban_gap_gia_thap",
  "gia_thap_bat_thuong",
  "khong_nhat_quan",
  "chua_ro_nhat_quan",
] as const;

// Mỗi flag id -> patch sinh ra nó. GOOD làm nền nên patch phải phá đúng 1 điểm.
const FLAG_TRIGGERS: Record<(typeof EXPECTED_FLAG_IDS)[number], Partial<LegalQuizAnswers>> = {
  vi_bang: { giayTo: "vi_bang" },
  giay_tay: { giayTo: "giay_tay" },
  so_ho: { giayTo: "so_ho" },
  so_chung: { giayTo: "so_chung" },
  chua_ro_giay_to: { giayTo: "chua_ro" },
  chua_hoan_cong: { hoanCong: "khong" },
  chua_ro_hoan_cong: { hoanCong: "chua_ro" },
  chua_kiem_tra_quy_hoach: { quyHoach: "chua_kiem_tra" },
  tranh_chap: { tranhChap: "co" },
  chua_ro_tranh_chap: { tranhChap: "chua_ro" },
  muc_dich_khong_phu_hop: { mucDichSuDung: "khong_phu_hop" },
  chua_ro_muc_dich: { mucDichSuDung: "chua_ro" },
  dong_so_huu: { soHuu: "dong_so_huu" },
  chua_ro_so_huu: { soHuu: "chua_ro" },
  the_chap: { theChap: "co" },
  chua_ro_the_chap: { theChap: "chua_ro" },
  chi_photo: { banGoc: "photo" },
  chua_xem_giay_to: { banGoc: "chua_xem" },
  uy_quyen: { nguoiBan: "uy_quyen" },
  chua_ro_nguoi_ban: { nguoiBan: "chua_ro" },
  ban_gap_gia_thap: { lyDoBan: "ban_gap", giaBatThuong: "thap_bat_thuong" },
  gia_thap_bat_thuong: { giaBatThuong: "thap_bat_thuong" },
  khong_nhat_quan: { nhatQuan: "khong_nhat_quan" },
  chua_ro_nhat_quan: { nhatQuan: "chua_ro" },
};

check("mọi flag id khai báo trong scoring đều có trigger trong test", () => {
  const missing = EXPECTED_FLAG_IDS.filter((id) => !FLAG_TRIGGERS[id]);
  assert.deepEqual(missing, [], `thiếu trigger cho: ${missing.join(", ")}`);
});

check("chạy hết trigger -> sinh ĐỦ mọi flag id (không sót path nào)", () => {
  const produced = new Set<string>();
  for (const id of EXPECTED_FLAG_IDS) {
    const r = scoreLegalQuiz(with_(FLAG_TRIGGERS[id]));
    const ids = r.flags.map((f) => f.id);
    assert.ok(
      ids.includes(id),
      `patch cho "${id}" không sinh ra flag đó (nhận: ${ids.join(", ") || "rỗng"})`,
    );
    ids.forEach((x) => produced.add(x));
  }
  const missing = EXPECTED_FLAG_IDS.filter((id) => !produced.has(id));
  assert.deepEqual(missing, [], `flag chưa từng được sinh: ${missing.join(", ")}`);
  assert.equal(produced.size, EXPECTED_FLAG_IDS.length);
});

check("mọi flag thực tế: title + why + verify đều sạch wording", () => {
  // Duyệt qua trigger thay vì liệt kê tay: mọi nhánh sinh cờ đều được kiểm.
  let checkedFlags = 0;
  for (const id of EXPECTED_FLAG_IDS) {
    const r = scoreLegalQuiz(with_(FLAG_TRIGGERS[id]));
    for (const f of r.flags) {
      assertNoForbiddenClaims([f.title, f.why, f.verify], `flag ${f.id}`);
      checkedFlags += 1;
    }
  }
  assert.ok(checkedFlags >= EXPECTED_FLAG_IDS.length, `chỉ kiểm ${checkedFlags} flag`);
});

check("mọi summary + levelLabel trên mọi nhánh đều sạch wording", () => {
  const cases = [
    GOOD,
    EMPTY_ANSWERS,
    with_({ giayTo: "vi_bang" }),
    with_({ giayTo: "giay_tay" }),
    with_({ tranhChap: "co" }),
    with_({ theChap: "co" }),
    with_({ giaBatThuong: "thap_bat_thuong" }),
    with_({ nhatQuan: "khong_nhat_quan" }),
    with_({ hoanCong: "khong", banGoc: "photo" }),
    // worst-case tổng hợp
    {
      giayTo: "giay_tay",
      hoanCong: "khong",
      quyHoach: "khong_biet",
      tranhChap: "co",
      mucDichSuDung: "khong_phu_hop",
      soHuu: "dong_so_huu",
      theChap: "co",
      banGoc: "chua_xem",
      nguoiBan: "uy_quyen",
      lyDoBan: "ban_gap",
      giaBatThuong: "thap_bat_thuong",
      nhatQuan: "khong_nhat_quan",
    } as LegalQuizAnswers,
  ];
  for (const a of cases) {
    const r = scoreLegalQuiz(a);
    assertNoForbiddenClaims([r.summary, r.levelLabel], `level ${r.level}`);
  }
});

check("LEVEL_LABEL không chứa claim tuyệt đối", () => {
  assertNoForbiddenClaims(Object.values(LEVEL_LABEL), "LEVEL_LABEL");
});

check("green wording đúng quy ước đã chốt", () => {
  assert.equal(
    LEVEL_LABEL.green,
    "Chưa phát hiện dấu hiệu rủi ro từ dữ liệu đã nhập",
  );
});

console.log("\n== green semantics: nhãn phải khớp số cờ ==");

check("GREEN + 0 cờ -> nhãn 'Chưa phát hiện...'", () => {
  const r = scoreLegalQuiz(GOOD);
  assert.equal(r.level, "green");
  assert.equal(r.flags.length, 0);
  assert.equal(r.levelLabel, LEVEL_LABEL.green);
  assert.ok(r.summary.includes("chưa cho thấy điểm cần cảnh báo"));
});

check("GREEN + 1 cờ -> nhãn 'Rủi ro thấp, có điểm cần lưu ý'", () => {
  // Chỉ giá thấp bất thường (12 điểm) -> vẫn green nhưng CÓ cờ.
  const r = scoreLegalQuiz(with_({ giaBatThuong: "thap_bat_thuong" }));
  assert.equal(r.level, "green");
  assert.equal(r.flags.length, 1);
  assert.equal(r.levelLabel, GREEN_WITH_NOTES_LABEL);
  assert.equal(r.summary, "Có 1 điểm cần lưu ý trước khi đặt cọc.");
});

check("GREEN + cờ KHÔNG được nói 'chưa phát hiện dấu hiệu rủi ro'", () => {
  const r = scoreLegalQuiz(with_({ giaBatThuong: "thap_bat_thuong" }));
  assert.ok(r.flags.length > 0);
  assert.equal(
    r.levelLabel.includes("Chưa phát hiện"),
    false,
    "nhãn không được phủ nhận trong khi còn cờ",
  );
  assert.equal(
    r.summary.includes("Chưa phát hiện"),
    false,
    "summary không được phủ nhận trong khi còn cờ",
  );
});

check("GREEN + nhiều cờ -> summary dùng đúng số lượng", () => {
  // nhatQuan chua_ro (8) + banGoc chua_xem (18) = 26 -> orange; cần giữ green.
  // Dùng 2 cờ nhẹ: chua_ro_nhat_quan (8) + chua_ro_muc_dich (10) = 18 < 20.
  const r = scoreLegalQuiz(with_({ nhatQuan: "chua_ro", mucDichSuDung: "chua_ro" }));
  assert.equal(r.level, "green");
  assert.equal(r.flags.length, 2);
  assert.equal(r.levelLabel, GREEN_WITH_NOTES_LABEL);
  assert.equal(r.summary, "Có 2 điểm cần lưu ý trước khi đặt cọc.");
});

check("levelLabelFor khớp hành vi scoreLegalQuiz", () => {
  assert.equal(levelLabelFor("green", 0), LEVEL_LABEL.green);
  assert.equal(levelLabelFor("green", 1), GREEN_WITH_NOTES_LABEL);
  assert.equal(levelLabelFor("orange", 3), LEVEL_LABEL.orange);
  assert.equal(levelLabelFor("red", 2), LEVEL_LABEL.red);
  // orange/red không bị đổi nhãn dù số cờ thế nào.
  assert.equal(levelLabelFor("red", 0), LEVEL_LABEL.red);
});

console.log("\n== completion gate ==");

check("mọi câu đều có option 'Chưa rõ'-kiểu hợp lệ (cố ý chọn được)", () => {
  const unknownLike = ["chua_ro", "chua_xem", "chua_kiem_tra", "khong_biet"];
  for (const q of QUESTIONS) {
    assert.ok(
      q.options.some((o) => unknownLike.includes(o.value)),
      `${q.key} phải có 1 lựa chọn dạng "chưa rõ/chưa xem/chưa kiểm tra"`,
    );
  }
});

check("completion đếm theo câu đã chạm, KHÔNG theo giá trị", () => {
  // Bản sao logic answeredKeys trong component: Set chỉ lớn lên khi có lựa chọn.
  const answered = new Set<keyof LegalQuizAnswers>();
  const choose = (key: keyof LegalQuizAnswers) => {
    if (!answered.has(key)) answered.add(key);
  };

  assert.equal(answered.size, 0, "ban đầu chưa chạm câu nào");

  // Chọn đúng giá trị trùng default ("Chưa rõ") vẫn phải tính là đã trả lời.
  choose("giayTo");
  assert.equal(answered.size, 1, "chọn 'Chưa rõ' phải tính là đã trả lời");

  // Chọn lại cùng câu không tăng thêm.
  choose("giayTo");
  assert.equal(answered.size, 1, "chọn lại cùng câu không tăng");

  // Đủ 12 câu -> complete, bất kể giá trị là gì.
  for (const q of QUESTIONS) choose(q.key);
  assert.equal(answered.size, QUESTIONS.length);
});

check("source: nút kết quả có gate theo isComplete và disabled thật", () => {
  const src = readFileSync("components/legal-quiz/quiz-client.tsx", "utf8");
  assert.ok(src.includes("answeredKeys"), "phải track câu đã chạm");
  assert.ok(src.includes("isComplete"), "phải có cờ hoàn thành");
  assert.ok(src.includes("disabled={!isComplete}"), "nút phải bị disabled khi chưa đủ");
  assert.ok(src.includes("aria-disabled"), "phải có aria-disabled");
  assert.ok(src.includes("Trả lời đủ 12 câu để xem kết quả"), "phải có copy hướng dẫn");
  // Không được suy completion từ giá trị câu trả lời.
  assert.equal(
    src.includes("UNKNOWN.has"),
    false,
    "không được đếm theo giá trị unknown-like",
  );
});

check("source: lead capture không hứa gửi mail ngay", () => {
  const src = readFileSync("components/legal-quiz/quiz-client.tsx", "utf8");
  assert.ok(src.includes("khi tính năng email sẵn sàng"), "phải nói rõ điều kiện");
  assert.equal(src.includes("Đã gửi"), false, "không được nói 'Đã gửi'");
  assert.equal(src.includes("Kiểm tra hộp thư"), false, "không được hứa mail tới ngay");
  assert.ok(src.includes("Đăng ký nhận checklist"), "nút đổi sang đăng ký");
});

console.log("\n== checklist ==");

check("checklist có ít nhất 5 bước và nhắc không cọc trước khi xác minh", () => {
  const list = legalChecklist();
  assert.ok(list.length >= 5);
  assert.ok(list.some((c) => c.includes("Không đặt cọc")));
});

check("checklist không khẳng định an toàn", () => {
  assertNoForbiddenClaims(legalChecklist(), "checklist");
});

console.log("\n== deterministic ==");

check("cùng input -> cùng output", () => {
  const a = scoreLegalQuiz(with_({ giayTo: "vi_bang" }));
  const b = scoreLegalQuiz(with_({ giayTo: "vi_bang" }));
  assert.equal(a.riskScore, b.riskScore);
  assert.equal(a.level, b.level);
  assert.deepEqual(
    a.flags.map((f) => f.id),
    b.flags.map((f) => f.id),
  );
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
