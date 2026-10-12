// OpenNext config cho Cloudflare Workers — tối thiểu cho shadow migration.
//
// Không custom KV/R2/D1/cache: bước đầu chỉ cần tương thích, không tối ưu.
// Incremental cache / tag cache mặc định là best-effort trong vùng Worker
// (đủ cho shadow; nếu cần chính xác hơn thì cấu hình lúc cutover).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
