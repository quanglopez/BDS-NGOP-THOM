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
    <section id="faq" className="mx-auto max-w-[760px] scroll-mt-20 px-5 py-12 md:px-8 md:py-16">
      <div className="text-center">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-ink">
          Giải đáp
        </div>
        <h2 className="mt-3 font-display text-h2 text-ink-900">Câu hỏi thường gặp</h2>
      </div>

      <div className="mt-8 space-y-3">
        {QA.map((item) => (
          <details
            key={item.q}
            className="group rounded-lg border border-line bg-white p-5 transition-colors duration-micro ease-cb hover:border-navy-600/25 hover:shadow-lift open:border-navy-600/25 open:shadow-lift"
          >
            <summary className="-my-2 flex cursor-pointer list-none items-center justify-between gap-4 py-2 text-small font-bold text-ink-900">
              {item.q}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-mist text-[16px] leading-none text-ink-600 transition-colors duration-micro ease-cb group-open:rotate-45 group-open:border-navy-900 group-open:bg-navy-900 group-open:text-white">
                +
              </span>
            </summary>
            <p className="mt-3 text-micro leading-[1.7] text-ink-600">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
