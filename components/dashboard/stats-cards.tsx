interface Stats {
  total: number;
  goodDeals: number;
  todayUsed: number;
  todayLimit: number;
}

// 3 thẻ thống kê: tổng tin, kèo ngon >80, giờ tiết kiệm
export function StatsCards({ stats }: { stats: Stats }) {
  // Mỗi tin check tay mất ~2 phút -> quy ra giờ tiết kiệm
  const hoursSaved = Math.round((stats.total * 2) / 60 * 10) / 10;

  const cards = [
    {
      label: "TỔNG TIN ĐÃ CHECK",
      value: stats.total,
      sub: `Hôm nay: ${stats.todayUsed}/${stats.todayLimit} lượt`,
      cls: "bg-navy text-white",
    },
    {
      label: "KÈO NGỘP NGON (>80)",
      value: stats.goodDeals,
      sub: stats.total > 0 ? `${Math.round((stats.goodDeals / stats.total) * 100)}% tin đạt` : "Chưa có dữ liệu",
      cls: "bg-emerald-600 text-white",
    },
    {
      label: "TIẾT KIỆM THỜI GIAN",
      value: `${hoursSaved}h`,
      sub: `≈ ${stats.total * 2} phút so với check tay`,
      cls: "bg-gold text-navy",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-[16px] p-5 ${c.cls}`}>
          <div className="text-[11px] font-bold tracking-[0.12em] opacity-80">{c.label}</div>
          <div className="mt-2 text-[32px] font-black leading-none">{c.value}</div>
          <div className="mt-2 text-[12px] opacity-80">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
