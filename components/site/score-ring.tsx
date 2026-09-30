/**
 * Vòng điểm dùng chung cho báo cáo thật (`ResultCard`) và bản xem trước
 * trên landing (`ExampleAnalysis`) — cùng một hình để khách thấy đúng thứ
 * mình sẽ nhận được.
 *
 * Thuần hiển thị: không đụng type `AnalysisResult`, không tính lại điểm.
 */

export type ScoreRingTone = "green" | "yellow" | "red";

type ScoreRingProps = {
  /** 0–100. Render nguyên giá trị truyền vào, không kẹp lại. */
  score: number;
  tone: ScoreRingTone;
  /** Nhãn đơn vị dưới số, ví dụ "/100 ĐIỂM" */
  caption?: string;
  className?: string;
};

// viewBox 120, bán kính 52 → chu vi 2*PI*52 ≈ 327
const RING_VIEWBOX = 120;
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 327;

const TONE_CLASS: Record<ScoreRingTone, string> = {
  green: "border-ai bg-ai-wash text-ai-ink",
  yellow: "border-risk-medium bg-risk-medium-wash text-risk-medium",
  red: "border-risk-high bg-risk-high-wash text-risk-high",
};

export function ScoreRing({ score, tone, caption = "/100", className = "" }: ScoreRingProps) {
  return (
    <div
      className={`relative flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-full border-[6px] bg-white ${TONE_CLASS[tone]} ${className}`}
    >
      <div className="text-center leading-none">
        <div className="font-display text-[30px] font-extrabold tabular-nums tracking-tight">{score}</div>
        <div className="mt-0.5 whitespace-nowrap text-micro font-semibold opacity-70">{caption}</div>
      </div>
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full -rotate-90"
        viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
      >
        <circle
          cx="60"
          cy="60"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          className="opacity-30"
        />
      </svg>
    </div>
  );
}