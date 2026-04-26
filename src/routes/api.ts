/**
 * ## api
 *
 * 所有 `/api/*` REST endpoint 的 Hono router。
 *
 * ### 端點一覽
 * - `GET/POST /drafts` — 列表 / 新建草稿
 * - `GET/PATCH/DELETE /drafts/:id` — 單篇 CRUD
 * - `POST /drafts/:id/publish` — 對單篇開 GitHub PR
 * - `POST /drafts/:id/translate` — 建立人工翻譯副本（直接複製內容）
 * - `POST /drafts/:id/ai-translate` — 使用 OpenAI 翻譯後建立副本
 * - `POST /drafts/:id/resync` — 從 GitHub 覆蓋本地草稿
 * - `GET /drafts/:id/translations` — 取得相同 slug 的其他語言版本
 * - `POST /batch-publish` — 多篇同時送出一個 PR
 * - `POST /batch-delete` — 批量刪除草稿
 * - `GET /github/posts` — 列出 GitHub 上的 .md 檔案
 * - `POST /sync` — 將 GitHub 文章匯入本地 DB
 * - `POST /upload` — 上傳圖片到 R2
 * - `GET /translation-status` — 檢查 AI 翻譯是否啟用
 *
 * ### 已知限制
 * - `publish` 與 `batch-publish` 的 frontmatter 序列化為自製格式，僅支援 string/boolean/array
 * - `slug` 若為空，會以 `slugify(title)` 產生，CJK 字元會被移除
 */
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { openPR, openBatchPR, listGithubPosts, getGithubFile } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft, extractFromPath } from "../lib/frontmatter";
import { translateDraft, isTranslationEnabled } from "../lib/translator";
import { uploadToR2, isR2Enabled } from "../lib/r2";

type Draft = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  description: string;
  tags: string;
  fields: string;
  content: string;
  status: string;
  pr_url: string;
  github_path: string;
  github_sha: string;
  source: string;
  created_at: string;
  updated_at: string;
};

const api = new Hono();

// GET /api/drafts
api.get("/drafts", (c) => {
  const drafts = db
    .query("SELECT id, title, lang, slug, status, pr_url, source, created_at, updated_at FROM drafts ORDER BY updated_at DESC")
    .all() as Draft[];
  return c.json(drafts);
});

// POST /api/drafts
api.post("/drafts", async (c) => {
  const now = new Date().toISOString();
  const id = nanoid();
  const body = await c.req.json().catch(() => ({})) as Partial<Draft>;

  db.query(
    `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?)`
  ).run(
    id,
    body.title ?? "",
    body.lang ?? "zh-tw",
    body.slug ?? "",
    body.description ?? "",
    body.tags ?? "[]",
    body.fields ?? "{}",
    body.content ?? "",
    now,
    now
  );

  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft;
  return c.json(draft, 201);
});

// GET /api/drafts/:id
api.get("/drafts/:id", (c) => {
  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(c.req.param("id")) as Draft | null;
  if (!draft) return c.json({ error: "Not found" }, 404);
  return c.json(draft);
});

// PATCH /api/drafts/:id
api.patch("/drafts/:id", async (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as Partial<Draft>;
  const now = new Date().toISOString();

  db.query(
    `UPDATE drafts SET
      title       = ?,
      lang        = ?,
      slug        = ?,
      description = ?,
      tags        = ?,
      fields      = ?,
      content     = ?,
      updated_at  = ?
    WHERE id = ?`
  ).run(
    body.title       ?? existing.title,
    body.lang        ?? existing.lang,
    body.slug        ?? existing.slug,
    body.description ?? existing.description,
    body.tags        ?? existing.tags,
    body.fields      ?? existing.fields,
    body.content     ?? existing.content,
    now,
    id
  );

  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft;
  return c.json(draft);
});

// DELETE /api/drafts/:id
api.delete("/drafts/:id", (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT id FROM drafts WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  db.query("DELETE FROM drafts WHERE id = ?").run(id);
  return c.json({ success: true });
});

// POST /api/drafts/:id/publish
api.post("/drafts/:id/publish", async (c) => {
  const id = c.req.param("id");
  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!draft) return c.json({ error: "Not found" }, 404);
  const fields = JSON.parse(draft.fields || "{}");
  const tags = JSON.parse(draft.tags || "[]");
  const date = typeof fields.pubDate === "string" && fields.pubDate
    ? fields.pubDate
    : new Date().toISOString().slice(0, 10);
  const slug = draft.slug || slugify(draft.title) || id;

  // Build frontmatter — lang is encoded in directory path, not in frontmatter
  const { lang: _lang, ...fieldsWithoutLang } = fields;
  const fm: Record<string, unknown> = {
    title: draft.title,
    pubDate: date,
  };
  if (draft.description) fm.description = draft.description;
  if (tags.length > 0) fm.tags = tags;
  Object.assign(fm, fieldsWithoutLang);

  const frontmatter = Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((x) => `"${x}"`).join(", ")}]`;
      if (typeof v === "boolean") return `${k}: ${v}`;
      return `${k}: ${String(v)}`;
    })
    .join("\n") + "\n";

  try {
    const { prUrl } = await openPR({
      title: draft.title,
      slug,
      lang: draft.lang,
      date,
      frontmatter,
      content: draft.content,
      githubPath: draft.github_path || undefined,
      githubSha: draft.github_sha || undefined,
    });

    db.query(
      "UPDATE drafts SET status = 'pr_opened', pr_url = ?, updated_at = ? WHERE id = ?"
    ).run(prUrl, new Date().toISOString(), id);

    return c.json({ success: true, pr_url: prUrl });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/batch-delete — delete multiple drafts at once
api.post("/batch-delete", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { draftIds?: string[] };
  if (!Array.isArray(body.draftIds) || body.draftIds.length === 0) {
    return c.json({ error: "draftIds is required" }, 400);
  }

  const deleted: string[] = [];
  for (const id of body.draftIds) {
    const existing = db.query("SELECT id FROM drafts WHERE id = ?").get(id);
    if (existing) {
      db.query("DELETE FROM drafts WHERE id = ?").run(id);
      deleted.push(id);
    }
  }

  return c.json({ success: true, deleted, count: deleted.length });
});

// POST /api/batch-publish — open one PR with multiple drafts
api.post("/batch-publish", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { draftIds?: string[] };
  if (!Array.isArray(body.draftIds) || body.draftIds.length === 0) {
    return c.json({ error: "draftIds is required" }, 400);
  }

  const drafts = body.draftIds
    .map((id) => db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null)
    .filter((d): d is Draft => d !== null);

  if (drafts.length === 0) return c.json({ error: "No valid drafts found" }, 404);

  const files = drafts.map((draft) => {
    const fields = JSON.parse(draft.fields || "{}");
    const tags = JSON.parse(draft.tags || "[]");
    const date = typeof fields.pubDate === "string" && fields.pubDate
      ? fields.pubDate
      : new Date().toISOString().slice(0, 10);
    const slug = draft.slug || slugify(draft.title) || draft.id;

    const { lang: _lang, ...fieldsWithoutLang } = fields;
    const fm: Record<string, unknown> = { title: draft.title, pubDate: date };
    if (draft.description) fm.description = draft.description;
    if (tags.length > 0) fm.tags = tags;
    Object.assign(fm, fieldsWithoutLang);

    const frontmatter = Object.entries(fm)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.map((x) => `"${x}"`).join(", ")}]`;
        if (typeof v === "boolean") return `${k}: ${v}`;
        return `${k}: ${String(v)}`;
      })
      .join("\n") + "\n";

    return {
      title: draft.title,
      slug,
      lang: draft.lang,
      date,
      frontmatter,
      content: draft.content,
      githubPath: draft.github_path || undefined,
      githubSha: draft.github_sha || undefined,
    };
  });

  try {
    const { prUrl } = await openBatchPR(files);
    const now = new Date().toISOString();
    for (const draft of drafts) {
      db.query("UPDATE drafts SET status = 'pr_opened', pr_url = ?, updated_at = ? WHERE id = ?")
        .run(prUrl, now, draft.id);
    }
    return c.json({ success: true, pr_url: prUrl, count: drafts.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /api/github/posts — list all posts from GitHub
api.get("/github/posts", async (c) => {
  try {
    const posts = await listGithubPosts();
    // Attach which paths are already synced locally
    const syncedPaths = new Set(
      (db.query("SELECT github_path FROM drafts WHERE github_path != ''").all() as { github_path: string }[])
        .map((r) => r.github_path)
    );
    const result = posts.map((p) => ({ ...p, synced: syncedPaths.has(p.path) }));
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/sync — import selected GitHub posts into local DB
api.post("/sync", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { paths?: string[] };
  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return c.json({ error: "paths is required" }, 400);
  }

  const imported: string[] = [];
  const updated: string[] = [];
  const errors: string[] = [];

  for (const path of body.paths) {
    try {
      const { content, sha } = await getGithubFile(path);
      const { frontmatter: fm, body: mdBody } = parseFrontmatter(content);
      const { title, description, tags, fields } = frontmatterToDraft(fm);
      const { lang, slug } = extractFromPath(path);
      const now = new Date().toISOString();

      // Check if already synced
      const existing = db.query("SELECT id FROM drafts WHERE github_path = ?").get(path) as { id: string } | null;

      if (existing) {
        db.query(
          `UPDATE drafts SET title=?, lang=?, slug=?, description=?, tags=?, fields=?, content=?, github_sha=?, updated_at=? WHERE id=?`
        ).run(title, lang, slug, description, tags, fields, mdBody, sha, now, existing.id);
        updated.push(path);
      } else {
        const newId = nanoid();
        db.query(
          `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, github_path, github_sha, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?, 'github', ?, ?)`
        ).run(newId, title, lang, slug, description, tags, fields, mdBody, path, sha, now, now);
        imported.push(path);
      }
    } catch (err) {
      errors.push(`${path}: ${String(err)}`);
    }
  }

  return c.json({ imported, updated, errors });
});

// POST /api/drafts/:id/resync — overwrite local draft with latest from GitHub
api.post("/drafts/:id/resync", async (c) => {
  const id = c.req.param("id");
  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!draft) return c.json({ error: "Not found" }, 404);
  if (!draft.github_path) return c.json({ error: "This draft has no GitHub source" }, 400);

  try {
    const { content, sha } = await getGithubFile(draft.github_path);
    const { frontmatter: fm, body: mdBody } = parseFrontmatter(content);
    const { title, lang, description, tags, fields } = frontmatterToDraft(fm);
    const now = new Date().toISOString();

    db.query(
      `UPDATE drafts SET title=?, lang=?, description=?, tags=?, fields=?, content=?, github_sha=?, updated_at=? WHERE id=?`
    ).run(title, lang, description, tags, fields, mdBody, sha, now, id);

    const updated = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft;
    return c.json(updated);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /api/drafts/:id/translations — list other drafts with the same slug
api.get("/drafts/:id/translations", (c) => {
  const id = c.req.param("id");
  const draft = db.query("SELECT slug FROM drafts WHERE id = ?").get(id) as { slug: string } | null;
  if (!draft) return c.json({ error: "Not found" }, 404);

  const slug = draft.slug;
  if (!slug) return c.json([]);

  const siblings = db.query(
    "SELECT id, lang, title, status FROM drafts WHERE slug = ? AND id != ? ORDER BY lang"
  ).all(slug, id) as { id: string; lang: string; title: string; status: string }[];

  return c.json(siblings);
});

// GET /api/translation-status — check if AI translation is available
api.get("/translation-status", (c) => {
  return c.json({ enabled: isTranslationEnabled() });
});

// POST /api/drafts/:id/ai-translate — create an AI-translated copy
api.post("/drafts/:id/ai-translate", async (c) => {
  const id = c.req.param("id");
  const source = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!source) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as { targetLang?: string };
  const targetLang = body.targetLang;
  if (!targetLang) return c.json({ error: "targetLang is required" }, 400);

  const slug = source.slug || slugify(source.title) || source.id;

  try {
    const translated = await translateDraft({
      title: source.title,
      description: source.description,
      content: source.content,
      sourceLang: source.lang,
      targetLang,
    });

    const now = new Date().toISOString();
    const newId = nanoid();

    db.query(
      `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?)`
    ).run(newId, translated.title, targetLang, slug, translated.description, source.tags, source.fields, translated.content, now, now);

    const newDraft = db.query("SELECT * FROM drafts WHERE id = ?").get(newId) as Draft;
    return c.json(newDraft, 201);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/drafts/:id/translate — create a translation copy with the same slug
api.post("/drafts/:id/translate", async (c) => {
  const id = c.req.param("id");
  const source = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!source) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as { targetLang?: string };
  const targetLang = body.targetLang;
  if (!targetLang) return c.json({ error: "targetLang is required" }, 400);

  const slug = source.slug || slugify(source.title) || source.id;
  const now = new Date().toISOString();
  const newId = nanoid();

  db.query(
    `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?)`
  ).run(newId, source.title, targetLang, slug, source.description, source.tags, source.fields, source.content, now, now);

  const newDraft = db.query("SELECT * FROM drafts WHERE id = ?").get(newId) as Draft;
  return c.json(newDraft, 201);
});

// POST /api/upload — upload an image to R2 and return its public URL
api.post("/upload", async (c) => {
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
 * 將文字轉換為 URL 安全的 slug。
 *
 * @param text - 任意標題字串
 * @returns 小寫英數字以 `-` 連接的字串，最長 50 字元
 *
 * @remarks
 * CJK 字元（Unicode 一–鿿）會被完全移除，非英數字元替換為 `-`。
 * 純中文標題會產生空字串，呼叫端需自行 fallback（通常 fallback 為 draft ID）。
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, "")   // remove CJK
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export default api;
