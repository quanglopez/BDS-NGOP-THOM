// FAQ tập trung xử lý phản đối — ngắn, rõ, tạo tin tưởng
const QA: { q: string; a: string }[] = [
  {
    q: "CheckBDS lấy dữ liệu từ đâu?",
    a: "Từ tin rao công khai mà bạn dán vào: link Nhà Tốt/Chợ Tốt hoặc nội dung tin. Chúng tôi không thu thập dữ liệu riêng tư và không bán dữ liệu của bạn.",
  },
  {
    q: "Điểm AI được tính như thế nào?",
    a: "Mỗi tin được chấm theo 6 tiêu chí: dấu hiệu bán gấp, tiềm năng tăng giá khu vực, thanh khoản, pháp lý, giá so với thị trường và vị trí. Mỗi tiêu chí có trọng số riêng, và kết quả luôn kèm lý do cộng/trừ điểm để bạn kiểm chứng.",
  },
  {
    q: "CheckBDS có thay thế môi giới không?",
    a: "Không. CheckBDS giúp bạn lọc tin nhanh hơn. Quyết định mua vẫn cần bạn xem nhà, kiểm chứng sổ đỏ và quy hoạch tại địa phương.",
  },
  {
    q: "Có thể check bao nhiêu tin?",
    a: "Gói Free: 20 tin/ngày. Gói PRO: 500 tin/ngày, có Bulk Check 100 tin/lần và quét cả trang danh mục.",
  },
  {
    q: "Có hỗ trợ Nhà Tốt/Chợ Tốt không?",
    a: "Có. Bạn dán link 1 tin thì tự lấy nội dung; dán link trang danh mục thì quét danh sách tin bán rồi chọn hàng loạt. Một số site khác chặn đọc tự động — khi đó tool sẽ hướng dẫn bạn copy mô tả tin.",
  },
  {
    q: "Tôi có thể hủy PRO không?",
    a: "Có, hủy bất kỳ lúc nào. Gói không tự động gia hạn — khi hết hạn hệ thống tự về gói Free, bạn chỉ mất lượt check nâng cao.",
  },
  {
    q: "Nếu mua rồi không phù hợp thì sao?",
    a: "Hoàn tiền 100% trong 3 ngày đầu nếu công cụ không hữu ích cho bạn. Liên hệ hỗ trợ là được xử lý.",
  },
  {
    q: "Dữ liệu tôi nhập có được lưu lại không?",
    a: "Nội dung tin chỉ dùng để chấm điểm tại thời điểm check. Điểm số và link tin được lưu vào lịch sử của riêng bạn để tra cứu, không chia sẻ cho bên thứ ba.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[760px] px-5 md:px-8 py-12 md:py-16 scroll-mt-20">
      <div className="text-center">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Giải đáp</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Câu hỏi thường gặp
        </h2>
      </div>

      <div className="mt-8 space-y-3">
        {QA.map((item) => (
          <details
            key={item.q}
            className="group rounded-[16px] border border-slate-200 bg-white p-5 hover:border-navy/25 hover:shadow-[0_12px_32px_-20px_rgba(11,29,58,0.35)] transition open:shadow-[0_12px_32px_-20px_rgba(11,29,58,0.35)] open:border-navy/25"
          >
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-[14px] font-bold text-navy">
              {item.q}
              <span className="shrink-0 w-7 h-7 rounded-full bg-cream border border-slate-200 flex items-center justify-center text-slate-500 group-open:rotate-45 group-open:bg-navy group-open:text-white group-open:border-navy transition text-[16px] leading-none">
                +
              </span>
            </summary>
            <p className="mt-3 text-[13px] leading-[1.7] text-slate-600">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
