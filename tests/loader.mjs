// Loader cho node --experimental-strip-types: phân giải alias @/ và import
// tương đối thiếu extension (./provinces -> ./provinces.ts).
// Chỉ dùng khi chạy test local, không ảnh hưởng build Next.
// Dùng: node --experimental-strip-types --import ./tests/loader.mjs tests/xxx.test.ts

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = [".ts", ".tsx", ".js", ".json"];

function withExt(abs) {
  if (path.extname(abs)) return null;
  for (const ext of EXTS) {
    if (existsSync(abs + ext)) return pathToFileURL(abs + ext).href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = withExt(path.join(ROOT, specifier.slice(2)));
    if (hit) return next(hit, context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    context.parentURL.startsWith("file:")
  ) {
    const hit = withExt(
      path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier),
    );
    if (hit) return next(hit, context);
  }
  return next(specifier, context);
}
