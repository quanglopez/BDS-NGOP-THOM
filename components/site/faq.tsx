// FAQ cho trang bán hàng
const QA: { q: string; a: string }[] = [
  {
    q: "Tool hỗ trợ khu vực nào?",
    a: "Toàn quốc: 63 tỉnh/thành phố. Dán tin có tên tỉnh, quận/huyện hoặc đường phố là AI tự nhận diện khu vực để chấm điểm vị trí, tăng giá và thanh khoản cho đúng.",
  },
  {
    q: "AI (Jev) ở đây là gì? Có chính xác không?",
    a: "Tool dùng mô hình AI chuyên chấm điểm bất động sản theo 6 tiêu chí: độ ngộp, tiềm năng tăng giá, thanh khoản, pháp lý, giá thị trường và vị trí. Độ chính xác ~85% với tin đầy đủ thông tin - AI giúp lọc nhanh, việc mua vẫn do bạn kiểm chứng sổ + quy hoạch.",
  },
  {
    q: "$0.042/1M token nghĩa là sao?",
    a: "Đó là chi phí tính theo dung lượng AI xử lý (token). Mỗi tin chỉ tốn vài nghìn token - chưa tới 10đ/tin. Phí 299k/tháng gồm chi phí AI, hạ tầng, vận hành và hỗ trợ.",
  },
  {
    q: "Tôi không rành công nghệ thì dùng được không?",
    a: "Được. Thao tác chỉ là dán tin vào ô hoặc upload file .txt/.csv rồi bấm Check. Không cần cài đặt gì thêm.",
  },
  {
    q: "Dữ liệu tin rao của tôi có bị chia sẻ không?",
    a: "Không. Tin chỉ được dùng để chấm điểm tại thời điểm check, kết quả (điểm + loại kèo) được lưu vào lịch sử của riêng bạn.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[760px] px-5 md:px-8 py-12 md:py-16 scroll-mt-20">
      <div className="text-center">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">
          Giải đáp
        </div>
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
