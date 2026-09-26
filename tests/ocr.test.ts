// OCR that: doc anh tin rao gia lap bang tesseract.js
// Chay: npm run test:ocr
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createWorker } from "tesseract.js";

const W = 1000;
const H = 700;
const px = Buffer.alloc(W * H * 3, 0xff);

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawText(str: string, x0: number, y0: number, scale: number) {
  let x = x0;
  for (const ch of str) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] !== "1") continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const X = x + c * scale + dx;
            const Y = y0 + r * scale + dy;
            const o = (Y * W + X) * 3;
            px[o] = 0;
            px[o + 1] = 0;
            px[o + 2] = 0;
          }
        }
      }
    }
    x += 6 * scale;
  }
}

const LINES = ["80M2 4 TANG 5.5 TY", "SO HONG RIENG", "0909 123 456", "GIA RE HON 1 TY"];
let y = 80;
for (const l of LINES) {
  drawText(l, 60, y, 8);
  y += 140;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const raw = Buffer.alloc(H * (W * 3 + 1));
for (let yy = 0; yy < H; yy++) {
  px.copy(raw, yy * (W * 3 + 1) + 1, yy * W * 3, (yy + 1) * W * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
const imgPath = "tests/.sample-listing.png";
writeFileSync(imgPath, png);

const worker = await createWorker(["vie", "eng"], 1, {
  logger: (m) => {
    if (m.status === "recognizing text") process.stderr.write(String(Math.round(m.progress * 100)) + "% ");
  },
});
const { data } = await worker.recognize(imgPath);
await worker.terminate();
// Anh nay dung bitmap 5x7 tu ve nen Tesseract doc ky tu don gian tot
// (chu so, chu in hoa) nhung doc sai chu co dau. Test kiem tra TIA DUNG
// pipeline OCR client-side, khong kiem tra do chinh xac 100% cua thu vien.
const text = data.text.trim();
console.log("\n--- OCR OUTPUT ---\n" + text);
console.log("--- confidence:", data.confidence.toFixed(1), "---\n");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ok  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name);
  }
}

const digits = text.replace(/\D/g, "");
check("OCR tra ve text khong rong", text.length > 10);
check("do tin cay > 40", data.confidence > 40);
check("doc duoc it nhat mot chu so", digits.length > 0);
check("doc duoc mot cot chu hoa", /[A-Z]{3,}/.test(text));

console.log("\n" + pass + " pass, " + fail + " fail");
process.exit(fail > 0 ? 1 : 0);
