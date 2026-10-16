// Custom Cloudflare Worker entry — Stage 2 PR-1: CHỈ thêm capability scheduled().
//
// Vì sao cần file này: OpenNext build GHI ĐÈ `.open-next/worker.js` từ template
// mỗi lần chạy, nên không thể sửa file đó. Thay vào đó trỏ `main` của wrangler
// vào entry này, và entry re-export nguyên vẹn worker do OpenNext sinh ra.
//
// - fetch: uỷ quyền NGUYÊN VẸN cho OpenNext (không bọc, không đổi hành vi).
// - DOQueueHandler / DOShardedTagCache / BucketCachePurge: re-export bắt buộc,
//   thiếu là mất Durable Object class của OpenNext.
// - scheduled: gọi thẳng logic cron nội bộ. KHÔNG fetch HTTP route của chính
//   mình (cùng zone -> lỗi 1042 + vòng lặp Worker).
//
// Chưa khai báo `triggers.crons` trong wrangler.jsonc: đây thuần là capability,
// Cloudflare schedules phải vẫn là [].
//
// `@ts-ignore` (KHÔNG phải @ts-expect-error): `.open-next/worker.js` chỉ tồn tại
// SAU khi OpenNext build xong, mà `next build` type-check file này TRƯỚC bước đó.
// Dùng @ts-expect-error sẽ vỡ khi file đã sinh ra (lúc đó không còn lỗi nữa).
// Đúng pattern chính thức của OpenNext: docs/cloudflare/howtos/custom-worker.
// @ts-ignore `.open-next/worker.js` được sinh lúc build
import openNextWorker from "../.open-next/worker.js";
import { createScheduledRunners } from "../lib/radar/cron-jobs";
import { hydrateProcessEnv, runScheduledCron, textEnv } from "../lib/radar/cron-dispatch";

// @ts-ignore `.open-next/worker.js` được sinh lúc build
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";

export default {
  fetch: openNextWorker.fetch,

  async scheduled(
    controller: { cron: string },
    env: Record<string, unknown>,
    _ctx: unknown,
  ): Promise<void> {
    const text = textEnv(env);
    // Scheduled handler không đi qua fetch path của OpenNext nên process.env
    // chưa được populate; tự đồng bộ để code dùng chung (adminClient) thấy secret.
    hydrateProcessEnv(text);
    await runScheduledCron({ cron: controller.cron, runners: createScheduledRunners(text) });
  },
};
