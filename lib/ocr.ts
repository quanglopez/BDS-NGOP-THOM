// OCR ảnh chụp màn hình thành text — chạy hoàn toàn trên trình duyệt (Tesseract.js + model vie).
// Lần đầu tải ~10MB, sau đó dùng cache của trình duyệt.

export type OcrProgress = (percent: number) => void;

export async function ocrImageToText(file: File, onProgress?: OcrProgress): Promise<string> {
  const { createWorker } = await import("tesseract.js");

  const worker = await createWorker(["vie", "eng"], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const { data } = await worker.recognize(file);
    const text = (data?.text ?? "").trim();
    if (!text) throw new Error("empty");
    return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await worker.terminate();
  }
}
