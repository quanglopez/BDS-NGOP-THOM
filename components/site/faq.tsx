// FAQ cho trang bán hàng
const QA: { q: string; a: string }[] = [
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
    <section className="mx-auto max-w-[760px] px-5 md:px-8 py-10">
      <h2 className="text-[22px] md:text-[28px] font-black tracking-tight text-navy text-center">
        Câu hỏi thường gặp
      </h2>

      <div className="mt-6 space-y-4">
        {QA.map((item) => (
          <details key={item.q} className="group rounded-[14px] border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-[14px] font-bold text-navy">
              {item.q}
              <span className="text-slate-400 group-open:rotate-45 transition-transform text-[18px] leading-none">
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
