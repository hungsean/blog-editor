/**
 * ## images
 *
 * 圖片庫的 REST endpoint，封裝 R2 與本地 `images` 表格之間的同步。
 *
 * ### 資料流
 * 前端只讀本地 DB（`GET /images`）；DB 內容由兩個來源寫入：
 * - `POST /images/sync` — 從儲存的 `uploads/` 前綴 list 出物件，upsert 進 DB
 * - `POST /images/upload` — 上傳新檔案到儲存，同時寫入 DB
 *
 * ### 已知限制
 * - 寫入 / 同步端點都需要 `c.var.storage` 已啟用（設定齊全），否則回傳 503
 * - sync 只匯入副檔名屬於 `IMAGE_EXT` 的物件，非圖片檔案會被略過
 * - 以物件鍵值（key）作為主鍵 upsert，重複 sync 不會產生重複資料
 *
 * @remarks
 * #04 起物件儲存改走 {@link import("../lib/storage/types").Storage} 抽象（`c.var.storage`），
 * 不再直接依賴 aws-sdk；self-host 注入 `S3Storage`、Workers 注入 R2 binding 的 `R2Storage`。
 */
import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { AppEnv } from "../app";
import { listImages, upsertImage, insertImage } from "../lib/repos/images";

/** 圖片在儲存中的存放前綴。 */
const UPLOAD_PREFIX = "uploads/";

/** sync 時允許匯入的圖片副檔名（小寫，不含點）。 */
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

interface ImageRow {
  key: string;
  url: string;
  size: number;
  uploaded_at: string;
}

const images = new Hono<AppEnv>();

// GET /api/images — 列出圖片庫（純讀本地 DB，不碰 R2）
images.get("/images", async (c) => {
  const rows = await listImages(c.var.db);
  return c.json(rows);
});

/**
 * POST /api/images/sync — 從 R2 `uploads/` 列出物件並 upsert 進 `images` 表格。
 *
 * @remarks
 * upsert 以 key 為衝突鍵，重複同步只會更新 url/size/uploaded_at，不會新增重複列。
 * 回傳 `synced` 為實際寫入的圖片數量（已過濾非圖片副檔名）。
 */
images.post("/images/sync", async (c) => {
  const storage = c.var.storage;
  if (!storage.isEnabled()) return c.json({ error: "R2 not configured" }, 503);

  let objects;
  try {
    objects = await storage.list(UPLOAD_PREFIX);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }

  let synced = 0;
  for (const obj of objects) {
    const ext = obj.key.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXT.has(ext)) continue;
    await upsertImage(c.var.db, {
      key: obj.key,
      url: obj.url,
      size: obj.size,
      uploaded_at: obj.lastModified,
    });
    synced++;
  }

  return c.json({ synced });
});

/**
 * POST /api/images/upload — 上傳一張圖片到 R2，並寫入 `images` 表格。
 *
 * @remarks
 * 物件鍵值為 `uploads/{nanoid}.{ext}`，與 sync 使用同一前綴，因此上傳後立即出現在圖片庫。
 * 接受 multipart form，欄位名為 `file`。
 */
images.post("/images/upload", async (c) => {
  const storage = c.var.storage;
  if (!storage.isEnabled()) return c.json({ error: "R2 not configured" }, 503);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: "Invalid form data" }, 400);

  const file = formData.get("file");
  if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const key = `${UPLOAD_PREFIX}${nanoid()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  try {
    await storage.put(key, buffer, file.type || "application/octet-stream");
    const url = storage.publicUrl(key);
    const uploaded_at = new Date().toISOString();
    await insertImage(c.var.db, { key, url, size: file.size, uploaded_at });
    return c.json({ key, url, size: file.size, uploaded_at } satisfies ImageRow);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default images;
