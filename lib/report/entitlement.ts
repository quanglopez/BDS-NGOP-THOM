// Entitlement — lớp capability cho report.
//
// Mục tiêu: component KHÔNG if (isPro) rải rác. Component hỏi "tôi được xem
// phần này không" qua capability, còn policy Free/PRO nằm 1 chỗ. Đổi policy sau
// này = sửa file này, không sửa component.
//
// CHƯA chốt policy cuối cùng (spec yêu cầu để config đổi được mà không sửa
// component). Vì vậy bảng dưới là giá trị HIỆN TẠI, ghi rõ để đổi được 1 chỗ:
// khi chốt policy, sửa PLAN_CAPABILITIES — component không cần đụng vào.

import { planAllowsProAnalysis } from "@/lib/quota";

export interface Entitlement {
  /** Mở toàn bộ report Pro (gọi /api/pro-analysis). */
  canViewFullReport: boolean;
  /** Xem phân tích giá tham chiếu. */
  canViewPriceIntelligence: boolean;
  /** Mở được chi tiết bằng chứng + vị trí trích dẫn. */
  canViewEvidenceDetail: boolean;
  /** Xem thư viện ảnh. */
  canViewGallery: boolean;
  /** Xem chi tiết khuyến nghị / bước kiểm tra. */
  canViewRecommendationDetail: boolean;
}

const ALL: Entitlement = {
  canViewFullReport: true,
  canViewPriceIntelligence: true,
  canViewEvidenceDetail: true,
  canViewGallery: true,
  canViewRecommendationDetail: true,
};

const NONE: Entitlement = {
  canViewFullReport: false,
  canViewPriceIntelligence: false,
  canViewEvidenceDetail: false,
  canViewGallery: false,
  canViewRecommendationDetail: false,
};

/**
 * Policy hiện tại: gói trả phí mở tất cả, Free không mở gì.
 * Dùng `planAllowsProAnalysis` (cùng hàm chặn server-side ở
 * /api/pro-analysis) để client và server KHÔNG lệch nhau — nếu client tưởng
 * Free được xem Pro mà server chặn, user thấy UI rồi bị lỗi.
 *
 * LƯU ý: đây là policy TẠM. Khi chốt (vd: Free được xem 2 module đầu), sửa
 * hàm này, không sửa component.
 */
export function buildEntitlement(input: { plan?: string | null } = {}): Entitlement {
  return planAllowsProAnalysis(input.plan) ? ALL : NONE;
}
