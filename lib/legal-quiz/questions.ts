// 12 câu hỏi Legal Quiz — định nghĩa UI (nhãn + options).
// Tách khỏi scoring để lib chấm điểm thuần túy (dễ test) và UI dễ đổi wording.
import type { LegalQuizAnswers } from "./scoring";

export type Option = { value: string; label: string };

export type Question = {
  key: keyof LegalQuizAnswers;
  /** Số thứ tự hiển thị (1..12). */
  index: number;
  title: string;
  /** Gợi ý ngắn dưới câu hỏi. */
  hint?: string;
  options: Option[];
};

const CHUA_RO: Option = { value: "chua_ro", label: "Chưa rõ" };

export const QUESTIONS: Question[] = [
  {
    key: "giayTo",
    index: 1,
    title: "Loại giấy tờ của bất động sản này là gì?",
    hint: "Câu quan trọng nhất — quyết định phần lớn rủi ro.",
    options: [
      { value: "so_do", label: "Sổ đỏ" },
      { value: "so_hong_rieng", label: "Sổ hồng riêng" },
      { value: "so_chung", label: "Sổ chung" },
      { value: "so_ho", label: "Sổ hộ" },
      { value: "vi_bang", label: "Vi bằng" },
      { value: "giay_tay", label: "Giấy tay" },
      CHUA_RO,
    ],
  },
  {
    key: "hoanCong",
    index: 2,
    title: "Công trình đã được hoàn công chưa?",
    hint: "Áp dụng khi có nhà/xây dựng trên đất.",
    options: [
      { value: "co", label: "Đã hoàn công" },
      { value: "khong", label: "Chưa hoàn công" },
      CHUA_RO,
    ],
  },
  {
    key: "quyHoach",
    index: 3,
    title: "Bạn đã kiểm tra quy hoạch chưa?",
    options: [
      { value: "da_kiem_tra", label: "Đã kiểm tra" },
      { value: "chua_kiem_tra", label: "Chưa kiểm tra" },
      { value: "khong_biet", label: "Không biết kiểm tra ở đâu" },
    ],
  },
  {
    key: "tranhChap",
    index: 4,
    title: "Bất động sản có đang bị tranh chấp không?",
    options: [
      { value: "khong", label: "Không" },
      { value: "co", label: "Có" },
      CHUA_RO,
    ],
  },
  {
    key: "mucDichSuDung",
    index: 5,
    title: "Mục đích sử dụng đất có phù hợp với nhu cầu của bạn không?",
    options: [
      { value: "phu_hop", label: "Phù hợp" },
      { value: "khong_phu_hop", label: "Không phù hợp" },
      CHUA_RO,
    ],
  },
  {
    key: "soHuu",
    index: 6,
    title: "Tài sản thuộc một chủ hay đồng sở hữu?",
    options: [
      { value: "mot_chu", label: "Một chủ" },
      { value: "dong_so_huu", label: "Đồng sở hữu" },
      CHUA_RO,
    ],
  },
  {
    key: "theChap",
    index: 7,
    title: "Bất động sản có đang bị thế chấp không?",
    options: [
      { value: "khong", label: "Không" },
      { value: "co", label: "Có" },
      CHUA_RO,
    ],
  },
  {
    key: "banGoc",
    index: 8,
    title: "Bạn đã xem bản gốc hay chỉ xem bản photo?",
    options: [
      { value: "ban_goc", label: "Bản gốc" },
      { value: "photo", label: "Bản photo" },
      { value: "chua_xem", label: "Chưa xem" },
    ],
  },
  {
    key: "nguoiBan",
    index: 9,
    title: "Người bán là ai?",
    options: [
      { value: "chinh_chu", label: "Chính chủ" },
      { value: "moi_gioi", label: "Môi giới" },
      { value: "uy_quyen", label: "Người được uỷ quyền" },
      CHUA_RO,
    ],
  },
  {
    key: "lyDoBan",
    index: 10,
    title: "Lý do bán là gì?",
    options: [
      { value: "binh_thuong", label: "Bình thường" },
      { value: "ban_gap", label: "Bán gấp" },
      CHUA_RO,
    ],
  },
  {
    key: "giaBatThuong",
    index: 11,
    title: "Giá có thấp bất thường so với khu vực không?",
    options: [
      { value: "binh_thuong", label: "Bình thường" },
      { value: "thap_bat_thuong", label: "Thấp bất thường" },
      CHUA_RO,
    ],
  },
  {
    key: "nhatQuan",
    index: 12,
    title: "Thông tin người bán và giấy tờ có nhất quán không?",
    options: [
      { value: "nhat_quan", label: "Nhất quán" },
      { value: "khong_nhat_quan", label: "Không nhất quán" },
      CHUA_RO,
    ],
  },
];

/** Đáp án mặc định: mọi câu đều "chưa rõ/chưa biết" — không mặc định tích cực. */
export const EMPTY_ANSWERS: LegalQuizAnswers = {
  giayTo: "chua_ro",
  hoanCong: "chua_ro",
  quyHoach: "chua_kiem_tra",
  tranhChap: "chua_ro",
  mucDichSuDung: "chua_ro",
  soHuu: "chua_ro",
  theChap: "chua_ro",
  banGoc: "chua_xem",
  nguoiBan: "chua_ro",
  lyDoBan: "chua_ro",
  giaBatThuong: "chua_ro",
  nhatQuan: "chua_ro",
};
