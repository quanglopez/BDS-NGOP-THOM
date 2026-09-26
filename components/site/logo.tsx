import Image from "next/image";

// Logo CheckBDS.online: ảnh gốc có nền trắng nên bọc trong khung bo góc
// để nằm gọn trên nền navy (header/footer) mà không bị lộ viền vuông.
export function Logo({
  height = 30,
  className = "",
  rounded = true,
}: {
  height?: number;
  className?: string;
  rounded?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center bg-white ${rounded ? "rounded-[10px] px-2 py-1.5" : ""} ${className}`}
    >
      <Image
        src="/logo.png"
        alt="CheckBDS.online - AI chấm điểm bất động sản"
        width={1374}
        height={422}
        style={{ height, width: "auto" }}
        priority
      />
    </span>
  );
}

// Chỉ phần biểu tượng (nhà + kính lúp + dấu tích), nền trong suốt — dùng cho favicon
export function LogoMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt="CheckBDS.online"
      width={408}
      height={422}
      style={{ height: size, width: "auto" }}
      className={className}
      priority
    />
  );
}
