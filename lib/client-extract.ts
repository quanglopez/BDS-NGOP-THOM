// Client helper: nhận diện URL trong nội dung dán và gọi /api/extract

export interface ExtractOk {
  ok: true;
  title: string;
  text: string;
  price_hint: string | null;
  area_hint: string | null;
  method: string;
  domain: string;
}

export interface ExtractErr {
  ok: false;
  reason: string;
  message: string;
}

// Lấy URL đầu tiên trong chuỗi (chấp nhận cả khi người dùng dán kèm text khác)
export function firstUrl(input: string): string | null {
  const m = input.match(/https?:\/\/[^\s"'<>)]+/i);
  return m ? m[0] : null;
}

// Clipboard là URL thuần -> dùng luôn, không cần ghép text
export function isBareUrl(input: string): boolean {
  return /^https?:\/\/\S+$/i.test(input.trim());
}

export async function extractFromUrl(url: string): Promise<ExtractOk | ExtractErr> {
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok || data.ok === false) {
      return { ok: false, reason: data.reason ?? "error", message: data.message ?? "Không lấy được nội dung trang." };
    }
    return data as ExtractOk;
  } catch {
    return { ok: false, reason: "network_error", message: "Lỗi mạng, thử lại sau." };
  }
}
