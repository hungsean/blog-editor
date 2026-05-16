const BASE = import.meta.env.VITE_API_URL ?? "";

export type ImageItem = {
  key: string;
  url: string;
  size: number;
  uploaded_at: string;
};

/** 取得圖片庫清單（後端直接讀本地 DB）。 */
export async function fetchImages(): Promise<ImageItem[]> {
  const res = await fetch(`${BASE}/api/images`);
  if (!res.ok) throw new Error("Failed to fetch images");
  return res.json();
}

/** 觸發後端從 R2 同步圖片清單進 DB，回傳寫入筆數。 */
export async function syncImages(): Promise<{ synced: number }> {
  const res = await fetch(`${BASE}/api/images/sync`, { method: "POST" });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error ?? "Failed to sync images");
  }
  return res.json();
}

/** 上傳一張圖片到 R2，後端會同時寫入圖片庫並回傳該筆資料。 */
export async function uploadImage(file: File): Promise<ImageItem> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE}/api/images/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error ?? "Failed to upload image");
  }
  return res.json();
}
