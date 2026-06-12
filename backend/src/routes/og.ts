/**
 * ## og
 *
 * OG 圖片相關 endpoint。
 *
 * - `POST /og/preview` — 依文章資料套模板生成 1200×630 OG 圖，直接回傳 PNG bytes 供前端預覽。
 * - `POST /og/upload` — 將生成好的 PNG 上傳到 R2，固定鍵值 `og/{draftId}.png`。
 *
 * ### 已知限制
 * - `heroImageUrl` 必須是公開可存取的 URL，satori 渲染時會 fetch 它。
 * - 首次生成需下載字型（約 8-10 MB），之後讀 `data/fonts/` 磁碟快取。
 * - 採「preview 生成 / upload 接收」兩段式：前端把 preview 回傳的同一個 PNG 送回 upload，
 *   避免重複生成，也不需暫存檔。
 */
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { generateArticleOg } from "../lib/ogImage";

const og = new Hono<AppEnv>();

/**
 * POST /api/og/preview — 生成 OG 圖並回傳 PNG bytes。
 *
 * @remarks
 * body 為 JSON：`{ title, description?, date?, tags?, heroImageUrl? }`。
 * `title` 必填；生成可能較慢（首次需下載字型），呼叫端應顯示 loading。
 */
og.post("/og/preview", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return c.json({ error: "title required" }, 400);
  }

  try {
    const png = await generateArticleOg({
      title: body.title,
      description: typeof body.description === "string" ? body.description : undefined,
      date: typeof body.date === "string" ? body.date : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      heroImageUrl: typeof body.heroImageUrl === "string" ? body.heroImageUrl : undefined,
    });
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/**
 * POST /api/og/upload — 將生成好的 OG PNG 上傳到 R2。
 *
 * @remarks
 * multipart form：`file`（PNG）、`draftId`。鍵值固定為 `og/{draftId}.png`，
 * 同一草稿重複生成會直接覆蓋。`draftId` 以字元白名單驗證避免路徑注入。
 */
og.post("/og/upload", async (c) => {
  const storage = c.var.storage;
  if (!storage.isEnabled()) return c.json({ error: "R2 not configured" }, 503);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: "Invalid form data" }, 400);

  const file = formData.get("file");
  const draftId = formData.get("draftId");
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  if (typeof draftId !== "string" || !draftId) return c.json({ error: "draftId required" }, 400);

  const safeId = draftId.replaceAll(/[^a-zA-Z0-9_-]/g, "");
  if (safeId !== draftId) return c.json({ error: "Invalid draftId" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `og/${safeId}.png`;

  try {
    await storage.put(key, bytes, "image/png");
    return c.json({ url: storage.publicUrl(key) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default og;
