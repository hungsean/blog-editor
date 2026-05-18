import { Hono } from "hono";
import { nanoid } from "nanoid";
import { mkdir, unlink, readdir, stat } from "node:fs/promises";
import { uploadToR2, isR2Enabled } from "../lib/r2";

const OG_TEMP_DIR = "data/og-temp";

const upload = new Hono();

async function ensureOgTempDir() {
  await mkdir(OG_TEMP_DIR, { recursive: true });
}

/** Delete og-temp files older than 24 hours. Fire-and-forget. */
async function cleanupOldOgTemp() {
  try {
    await ensureOgTempDir();
    const files = await readdir(OG_TEMP_DIR);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    await Promise.all(
      files.map(async (f) => {
        const s = await stat(`${OG_TEMP_DIR}/${f}`).catch(() => null);
        if (s && s.mtimeMs < cutoff) await unlink(`${OG_TEMP_DIR}/${f}`).catch(() => {});
      })
    );
  } catch { /* non-fatal */ }
}

// POST /api/upload/r2
upload.post("/upload/r2", async (c) => {
  if (!isR2Enabled()) return c.json({ error: "R2 not configured" }, 503);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("file") as File | null;
  if (!file || typeof file === "string") return c.json({ error: "No file provided" }, 400);

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const key = `uploads/${nanoid()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  try {
    const url = await uploadToR2(key, buffer, file.type || "application/octet-stream");
    return c.json({ url });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/**
 * POST /api/upload/temp — 暫存圖片到 data/og-temp/，回傳 token 供後續使用。
 *
 * @remarks
 * token 格式為 `{nanoid}.{ext}`，24 小時後由 cleanupOldOgTemp 清除。
 * 僅接受 JPEG、PNG、WebP，最大 30 MB。
 */
upload.post("/upload/temp", async (c) => {
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: "Invalid form data" }, 400);

  const file = formData.get("file");
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);

  const ALLOWED_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const ext = ALLOWED_MIME[file.type];
  if (!ext) return c.json({ error: "Only JPEG, PNG, or WebP images are allowed" }, 415);

  const MAX_BYTES = 30 * 1024 * 1024;
  if (file.size > MAX_BYTES) return c.json({ error: "Image must be 30 MB or smaller" }, 413);

  await ensureOgTempDir();
  cleanupOldOgTemp(); // fire-and-forget

  const token = `${nanoid()}.${ext}`;
  await Bun.write(`${OG_TEMP_DIR}/${token}`, new Uint8Array(await file.arrayBuffer()));

  return c.json({ token });
});

/**
 * GET /api/upload/temp/:token — 取得暫存圖片，以 base64 data URL 回傳。
 *
 * @remarks
 * 供前端在生成 OG 圖片時取得 hero 圖片內容。
 * token 格式為 `{nanoid}.{ext}`，只允許字母、數字、底線、連字號、點。
 */
upload.get("/upload/temp/:token", async (c) => {
  const token = c.req.param("token");
  const safeToken = token.replaceAll(/[^a-zA-Z0-9._-]/g, "");
  if (safeToken !== token) return c.json({ error: "Invalid token" }, 400);

  const tempFile = Bun.file(`${OG_TEMP_DIR}/${safeToken}`);
  if (!(await tempFile.exists())) return c.json({ error: "Token not found or expired" }, 404);

  const bytes = new Uint8Array(await tempFile.arrayBuffer());
  const mime = tempFile.type || "image/jpeg";
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

  return c.json({ dataUrl });
});

export default upload;
