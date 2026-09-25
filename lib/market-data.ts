// Bảng giá thị trường Vũng Tàu + tin mẫu để test nhanh

export interface MarketArea {
  khu: string;
  avg: string;
  hot: boolean;
  tang: string;
}

export const marketAreas: MarketArea[] = [
  { khu: "Mặt tiền Thùy Vân", avg: "90-105", hot: true, tang: "+12%/năm" },
  { khu: "Trần Phú - Bãi Trước", avg: "85-110", hot: true, tang: "+10%/năm" },
  { khu: "Hạ Long - Bãi Dâu", avg: "75-90", hot: false, tang: "+8%/năm" },
  { khu: "Bãi Sau - Chí Linh", avg: "60-80", hot: true, tang: "+15%/năm" },
  { khu: "Phường 8 - Thắng Nhất", avg: "40-55", hot: false, tang: "+6%/năm" },
  { khu: "Phường 11 - Phước Thắng", avg: "35-48", hot: false, tang: "+7%/năm" },
];

export const exampleListings: string[] = [
  "Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ (rẻ hơn thị trường 1 tỷ), sổ hồng riêng, hẻm xe hơi, cách biển 50m",
  "Chính chủ cần tiền gấp bán lô đất Bãi Sau 100m2, đường 12m, giá 4.2 tỷ, rẻ hơn 800tr so với xung quanh, sổ hồng riêng hoàn công",
  "Bán nhà hẻm nhỏ 2m phường 8, 45m2, giấy tay, quy hoạch treo, giá 2.8 tỷ - cao hơn thị trường",
];
