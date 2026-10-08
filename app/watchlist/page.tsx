import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/site/logo";
import { listWatchlist } from "@/lib/watchlist/data";
import { toRowView, type WatchlistRowView } from "@/lib/watchlist/row-view";
import { WatchlistList } from "@/components/watchlist/watchlist-list";

export const metadata: Metadata = {
  title: "Theo dõi - CheckBDS.online",
  robots: { index: false, follow: false },
};

// Watchlist = shortlist công việc của môi giới (môi giới ưu tiên Nền tảng).
// CHỈ đọc DB của user qua lib/watchlist/data.ts — không gọi AI, không tính
// quota, không đọc checks/market_listings trực tiếp ở page.
export default async function WatchlistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent("/watchlist")}`);

  let rows: WatchlistRowView[] = [];
  let loadError = false;
  try {
    const entries = await listWatchlist(supabase, user.id);
    rows = entries.map(toRowView);
  } catch {
    // DB chưa có bảng / migration 0024 chưa chạy -> hiện lỗi rõ, không trắng trang.
    loadError = true;
  }

  return (
    <main className="min-h-screen bg-cream">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-navy/90 border-b border-white/10">
        <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between gap-3">
          <Link href="/" className="flex min-h-12 items-center shrink-0">
            <Logo height={24} />
          </Link>
          <nav aria-label="Điều hướng tài khoản" className="flex items-center gap-3 text-small">
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center text-gold-soft hover:text-white"
            >
              Dashboard
            </Link>
            <Link
              href="/watchlist"
              aria-current="page"
              className="inline-flex min-h-12 items-center text-white"
            >
              Theo dõi
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-5 md:px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-micro font-semibold uppercase tracking-[0.18em] text-gold-ink">
              WATCHLIST
            </p>
            <h1 className="mt-1 text-h2 text-navy">Theo dõi</h1>
            <p className="mt-2 text-small text-ink-600">
              Kèo đã lưu: cập nhật trạng thái, ghi chú cuộc gọi, quay lại nhanh. Lưu không tốn
              lượt kiểm tra.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/radar"
              className="inline-flex h-12 items-center rounded-[10px] bg-navy px-4 text-[13px] font-bold text-white hover:bg-navy/90"
            >
              Mở Radar
            </Link>
          </div>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-risk-high/30 bg-risk-high-wash p-4 text-small text-risk-high"
          >
            Không tải được watchlist. Thử tải lại trang.
          </div>
        ) : (
          <div className="mt-6">
            <WatchlistList initialRows={rows} total={rows.length} />
          </div>
        )}
      </div>
    </main>
  );
}
