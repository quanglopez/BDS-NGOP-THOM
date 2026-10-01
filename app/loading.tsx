/**
 * Skeleton dùng khi route đang tải — thay vì trắng xóa rồi nhảy nội dung vào.
 *
 * Nguyên tắc: skeleton phải gần hình dạng trang đích để không gây layout shift
 * lớn. Ở đây dùng khối trung tâm theo trục chữ của landing page (tiêu đề +
 * đoạn dẫn + hai nút), vì đây là bố cục chung của các route nội bộ.
 *
 * Chỉ dùng token có sẵn (`bg-cream`, `bg-line`, `rounded-sm`, `rounded-md`).
 * Không thêm animation tùy chỉnh: `animate-pulse` là mặc định của Tailwind và
 * đã dùng ở `components/report/price-intelligence-section.tsx`.
 */
export default function Loading() {
  return (
    // `aria-busy` báo cho trình đọc màn hình biết nội dung đang tải; dòng
    // `sr-only` bên dưới nói rõ điều đó bằng lời.
    <main className="flex min-h-screen flex-col bg-cream" aria-busy="true">
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col items-center justify-center px-5 py-14 md:px-8 md:py-20">
        <div className="flex w-full max-w-[560px] flex-col items-center text-center">
          {/* Tiêu đề: 2 dòng, rộng theo trục chữ. */}
          <div className="h-8 w-11/12 max-w-[420px] animate-pulse rounded-sm bg-line" />
          <div className="mt-3 h-8 w-8/12 max-w-[300px] animate-pulse rounded-sm bg-line" />

          {/* Đoạn dẫn: 3 dòng, độ dài bậc thang. */}
          <div className="mt-6 w-full space-y-2.5">
            <div className="mx-auto h-4 w-full max-w-[520px] animate-pulse rounded-sm bg-line" />
            <div className="mx-auto h-4 w-10/12 max-w-[420px] animate-pulse rounded-sm bg-line" />
            <div className="mx-auto h-4 w-6/12 max-w-[300px] animate-pulse rounded-sm bg-line" />
          </div>

          {/* Hai nút: cao đúng 54px như CTA thật để không lệch khi nội dung vào. */}
          <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <div className="h-[54px] w-full animate-pulse rounded-md bg-line sm:w-[180px]" />
            <div className="h-[54px] w-full animate-pulse rounded-md bg-line sm:w-[180px]" />
          </div>
        </div>

        <span className="sr-only">Đang tải nội dung…</span>
      </div>
    </main>
  );
}
