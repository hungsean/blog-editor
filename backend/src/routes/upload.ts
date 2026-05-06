import { Hono } from "hono";
import { nanoid } from "nanoid";
import { mkdir, unlink, readdir, stat } from "node:fs/promises";
import { db } from "../lib/db";
import { uploadToR2, isR2Enabled } from "../lib/r2";
import { generateArticleOg } from "../lib/ogImage";
import type { Draft } from "../types";

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

// POST /api/upload
upload.post("/upload", async (c) => {
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

// POST /api/drafts/:id/og-hero — temporarily store hero image on disk, return a token
upload.post("/drafts/:id/og-hero", async (c) => {
  const id = c.req.param("id");
  const draft = db.query("SELECT id FROM drafts WHERE id = ?").get(id) as { id: string } | null;
  if (!draft) return c.json({ error: "Not found" }, 404);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: "Invalid form data" }, 400);

  const heroFile = formData.get("heroImage");
  if (!(heroFile instanceof File)) return c.json({ error: "heroImage file required" }, 400);

  const ALLOWED_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const ext = ALLOWED_MIME[heroFile.type];
  if (!ext) return c.json({ error: "Only JPEG, PNG, or WebP images are allowed" }, 415);

  const MAX_BYTES = 30 * 1024 * 1024;
  if (heroFile.size > MAX_BYTES) return c.json({ error: "Image must be 30 MB or smaller" }, 413);

  await ensureOgTempDir();
  cleanupOldOgTemp(); // fire-and-forget

  const token = `${id}-${nanoid()}.${ext}`;
  const tempPath = `${OG_TEMP_DIR}/${token}`;
  await Bun.write(tempPath, new Uint8Array(await heroFile.arrayBuffer()));

  return c.json({ heroToken: token });
});

// POST /api/drafts/:id/generate-og
upload.post("/drafts/:id/generate-og", async (c) => {
  if (!isR2Enabled()) return c.json({ error: "R2 not configured" }, 503);

  const id = c.req.param("id");
  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!draft) return c.json({ error: "Not found" }, 404);

  const fields = JSON.parse(draft.fields || "{}");
  const tags = JSON.parse(draft.tags || "[]");
  const date = typeof fields.pubDate === "string" && fields.pubDate
    ? fields.pubDate
    : new Date().toISOString().slice(0, 10);

  const body = await c.req.json().catch(() => ({})) as { heroToken?: string };
  let heroImageUrl: string | undefined;
  let heroTempPath: string | undefined;
  let heroWarning: string | undefined;

  if (body.heroToken) {
    const safeToken = body.heroToken.replaceAll(/[^a-zA-Z0-9._-]/g, "");
    if (safeToken !== body.heroToken) {
      return c.json({ error: "Invalid heroToken" }, 400);
    }
    if (!safeToken.startsWith(`${id}-`)) {
      return c.json({ error: "heroToken does not belong to this draft" }, 400);
    }
    heroTempPath = `${OG_TEMP_DIR}/${safeToken}`;
    const tempFile = Bun.file(heroTempPath);
    if (await tempFile.exists()) {
      const bytes = new Uint8Array(await tempFile.arrayBuffer());
      const mime = tempFile.type || "image/jpeg";
      heroImageUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    } else {
      heroWarning = "heroToken not found or expired; OG generated without hero image";
    }
  }

  try {
    const pngBytes = await generateArticleOg({
      title: draft.title,
      description: draft.description || undefined,
      date,
      tags,
      heroImageUrl,
    });

    const ogKey = `og/${id}.png`;
    const ogUrl = await uploadToR2(ogKey, pngBytes, "image/png");

    const updatedFields = { ...fields, ogImage: ogUrl };
    const now = new Date().toISOString();
    db.query("UPDATE drafts SET fields = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(updatedFields), now, id);

    if (heroTempPath) await unlink(heroTempPath).catch(() => {});

    const updatedDraft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft;
    return c.json({ success: true, ogImageUrl: ogUrl, draft: updatedDraft, ...(heroWarning ? { warning: heroWarning } : {}) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default upload;
