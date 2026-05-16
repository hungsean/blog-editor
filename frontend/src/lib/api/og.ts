const BASE = import.meta.env.VITE_API_URL ?? "";

export interface OgPreviewParams {
  title: string;
  description?: string;
  /** YYYY-MM-DD */
  date?: string;
  tags?: string[];
  heroImageUrl: string;
}

/**
 * 請後端套模板生成 OG 圖，回傳 PNG blob 供預覽。
 *
 * @remarks
 * 首次生成較慢（後端需下載字型），呼叫端應顯示 loading。
 */
export async function generateOgPreview(params: OgPreviewParams): Promise<Blob> {
  const res = await fetch(`${BASE}/api/og/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error ?? "Failed to generate OG image");
  }
  return res.blob();
}

/** 將生成好的 OG PNG 上傳到 R2，固定鍵值 `og/{draftId}.png`，回傳公開 URL。 */
export async function uploadOgImage(draftId: string, png: Blob): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", png, `${draftId}.png`);
  formData.append("draftId", draftId);
  const res = await fetch(`${BASE}/api/og/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error ?? "Failed to upload OG image");
  }
  return res.json();
}
