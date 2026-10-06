// Self-check: JEV forensic observability (Phase 7).
// Chứng minh:
//  - canonical payload -> deterministic input hash
//  - raw response khác -> raw hash khác; giống -> giống
//  - hash KHÔNG chứa plaintext listing
//  - safeHeader chặn giá trị lạ (token/PII)
//  - SHA-256 đúng vector test NIST đã biết
// KHÔNG gọi production provider.
import assert from "node:assert/strict";
import { sha256Hex, safeHeader } from "@/lib/ai/jev-check";

assert.equal(
  await sha256Hex(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "SHA-256 vector rỗng (NIST)",
);
assert.equal(
  await sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "SHA-256 vector 'abc' (NIST)",
);

// Cùng canonical payload -> cùng input hash (deterministic).
const payloadA = { model: "jev-latest", state: "Khu vực: TP.HCM\nnhà", questions: { q: 1 } };
const payloadA2 = { model: "jev-latest", state: "Khu vực: TP.HCM\nnhà", questions: { q: 1 } };
assert.equal(
  await sha256Hex(JSON.stringify(payloadA)),
  await sha256Hex(JSON.stringify(payloadA2)),
  "cùng canonical payload phải cùng hash",
);

// Raw response khác -> hash khác; giống -> giống.
const raw1 = JSON.stringify({ answers: { investment_potential: { score: 3 } } });
const raw2 = JSON.stringify({ answers: { investment_potential: { score: 4 } } });
assert.notEqual(await sha256Hex(raw1), await sha256Hex(raw2), "response khác -> hash khác");
assert.equal(await sha256Hex(raw1), await sha256Hex(raw1), "response giống -> hash giống");

// Hash KHÔNG chứa plaintext listing.
const listing = "Bán gấp nhà hẻm xe hơi 6m P.Tân Quy Q7 55m² 4.6 tỷ sổ hồng";
const listingHash = await sha256Hex(listing);
assert.ok(!listingHash.includes("Bán gấp"), "hash không chứa plaintext");
assert.ok(!listingHash.includes("Tân Quy"), "hash không chứa plaintext địa chỉ");
assert.equal(listingHash.length, 64, "SHA-256 hex = 64 ký tự");

// safeHeader: chỉ nhận giá trị an toàn.
assert.equal(safeHeader("jev-2.1.0"), "jev-2.1.0");
assert.equal(safeHeader("req_abc123-XYZ.9"), "req_abc123-XYZ.9");
assert.equal(safeHeader(null), null, "thiếu header -> null");
assert.equal(safeHeader("Bearer secret-token-xyz"), null, "token-like -> null (không log)");
assert.equal(safeHeader("hà nội"), null, "PII/Unicode -> null");
assert.equal(safeHeader("a".repeat(129)), null, "quá dài -> null");

console.log("jev-forensics: all pass");
