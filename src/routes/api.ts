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
 * - `GET /drafts/:id/slug-check` — 即時檢查 slug 可用性（同語言唯一性）
 * - `POST /batch-publish` — 多篇同時送出一個 PR
 * - `POST /batch-delete` — 批量刪除草稿
 * - `GET /github/posts` — 列出 GitHub 上的 .md 檔案
 * - `POST /sync` — 將 GitHub 文章匯入本地 DB
 * - `POST /upload` — 上傳圖片到 R2
 * - `POST /drafts/:id/og-hero` — 暫存 OG 封面圖到 data/og-temp/，回傳 heroToken（不上傳 R2）
 * - `POST /drafts/:id/generate-og` — 動態生成 OG 圖片並上傳到 R2，更新 fields.ogImage；heroToken 讀暫存檔轉 data URL
 * - `GET /translation-status` — 檢查 AI 翻譯是否啟用
 * - `GET/POST /presets` — 常用翻譯設定列表 / 新增
 * - `GET/PATCH/DELETE /presets/:id` — 單筆常用翻譯 CRUD
 *
 * ### 已知限制
 * - `publish` 與 `batch-publish` 的 frontmatter 序列化為自製格式，僅支援 string/boolean/array
 * - `slug` 若為空，publish 時會嘗試以 `slugify(title)` 產生；若仍為空則阻擋送出
 * - slug 唯一性規則為同語言內唯一（`lang + slug` 不重複），不同語言可用相同 slug
 */
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { openPR, openBatchPR, listGithubPosts, getGithubFile } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft, extractFromPath } from "../lib/frontmatter";
import { translateDraft, isTranslationEnabled } from "../lib/translator";
import { uploadToR2, isR2Enabled } from "../lib/r2";
import { generateArticleOg } from "../lib/ogImage";
import { mkdir, unlink, readdir, stat } from "node:fs/promises";

const OG_TEMP_DIR = "data/og-temp";

async function ensureOgTempDir() {
  await mkdir(OG_TEMP_DIR, { recursive: true });
}

/** Delete og-temp files older than 24 hours */
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

type TranslationPreset = {
  id: string;
  keywords: string;
  translations: string;
  note: string;
  created_at: string;
  updated_at: string;
};

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
  created_at: string;
  updated_at: string;
};

const api = new Hono();

// GET /api/drafts
api.get("/drafts", (c) => {
  const drafts = db
    .query("SELECT id, title, lang, slug, status, pr_url, github_path, github_sha, created_at, updated_at FROM drafts ORDER BY DATE(json_extract(fields, '$.pubDate')) DESC, updated_at DESC")
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
    body.slug?.trim() ?? "",
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
    body.slug !== undefined ? body.slug.trim() : existing.slug,
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

  // Resolve slug — no fallback to id; empty slug is a hard error
  const slug = draft.slug?.trim() || slugify(draft.title);
  if (!slug) {
    return c.json({ success: false, reason: "required", error: "Slug is required" }, 400);
  }

  // Check same-lang slug conflict
  const slugConflict = db.query(
    "SELECT id, title, lang, slug, status, github_path FROM drafts WHERE lang = ? AND TRIM(slug) = ? AND id != ? LIMIT 1"
  ).get(draft.lang, slug, id) as { id: string; title: string; lang: string; slug: string; status: string; github_path: string } | null;
  if (slugConflict) {
    return c.json({ success: false, reason: "conflict", error: "Slug already exists in this language", conflict: slugConflict }, 400);
  }

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

  // ── Slug validation ─────────────────────────────────────────────────────────
  // Resolve final slug for each draft (no fallback to id)
  const resolved = drafts.map((d) => ({ draft: d, slug: d.slug?.trim() || slugify(d.title) }));

  // Block if any draft has empty slug
  const emptySlugDrafts = resolved.filter((r) => !r.slug);
  if (emptySlugDrafts.length > 0) {
    return c.json({
      success: false,
      reason: "slug_required",
      error: "Some drafts are missing a slug",
      drafts: emptySlugDrafts.map((r) => ({ id: r.draft.id, title: r.draft.title })),
    }, 400);
  }

  // Check internal duplicates within this batch (same lang + slug)
  const batchKeys = new Map<string, Array<{ id: string; title: string }>>();
  for (const { draft, slug } of resolved) {
    const key = `${draft.lang}:${slug}`;
    if (!batchKeys.has(key)) batchKeys.set(key, []);
    batchKeys.get(key)!.push({ id: draft.id, title: draft.title });
  }
  const internalConflicts = [...batchKeys.entries()]
    .filter(([, ds]) => ds.length > 1)
    .map(([key, ds]) => {
      const colonIdx = key.indexOf(":");
      return { type: "duplicate_in_batch", lang: key.slice(0, colonIdx), slug: key.slice(colonIdx + 1), drafts: ds };
    });

  // Check each draft against existing DB records (excluding all batch members)
  const batchIds = drafts.map((d) => d.id);
  const placeholders = batchIds.map(() => "?").join(",");
  const dbConflicts: object[] = [];
  for (const { draft, slug } of resolved) {
    // Skip if already flagged as internal conflict
    if (batchKeys.get(`${draft.lang}:${slug}`)!.length > 1) continue;
    const conflict = db.query(
      `SELECT id, title, lang, slug, status, github_path FROM drafts WHERE lang = ? AND TRIM(slug) = ? AND id NOT IN (${placeholders}) LIMIT 1`
    ).get(draft.lang, slug, ...batchIds) as { id: string; title: string; lang: string; slug: string; status: string; github_path: string } | null;
    if (conflict) {
      dbConflicts.push({ type: "existing_draft", lang: draft.lang, slug, draft: { id: draft.id, title: draft.title }, conflict });
    }
  }

  const allConflicts = [...internalConflicts, ...dbConflicts];
  if (allConflicts.length > 0) {
    return c.json({ success: false, reason: "slug_conflicts", error: "Slug conflicts found", conflicts: allConflicts }, 400);
  }
  // ── End slug validation ──────────────────────────────────────────────────────

  const files = resolved.map(({ draft, slug }) => {
    const fields = JSON.parse(draft.fields || "{}");
    const tags = JSON.parse(draft.tags || "[]");
    const date = typeof fields.pubDate === "string" && fields.pubDate
      ? fields.pubDate
      : new Date().toISOString().slice(0, 10);

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
          `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, github_path, github_sha, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?, ?, ?)`
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

  const slug = draft.slug.trim();
  if (!slug) return c.json([]);

  const siblings = db.query(
    "SELECT id, lang, title, status FROM drafts WHERE TRIM(slug) = ? AND id != ? ORDER BY lang"
  ).all(slug, id) as { id: string; lang: string; title: string; status: string }[];

  return c.json(siblings);
});

// GET /api/drafts/:id/slug-check — real-time availability check (same-lang uniqueness)
api.get("/drafts/:id/slug-check", (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT id FROM drafts WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const lang = c.req.query("lang");
  if (!lang) return c.json({ error: "lang is required" }, 400);

  const slug = (c.req.query("slug") ?? "").trim();
  if (!slug) {
    return c.json({ ok: false, reason: "required", message: "Slug is required", conflict: null });
  }

  const conflict = db.query(
    "SELECT id, title, lang, slug, status, github_path FROM drafts WHERE lang = ? AND TRIM(slug) = ? AND id != ? LIMIT 1"
  ).get(lang, slug, id) as { id: string; title: string; lang: string; slug: string; status: string; github_path: string } | null;

  if (conflict) {
    return c.json({ ok: false, reason: "conflict", message: "Slug already exists in this language", conflict });
  }

  return c.json({ ok: true, reason: "available", message: "Slug is available", conflict: null });
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

  const slug = (source.slug?.trim()) || slugify(source.title);
  if (!slug) return c.json({ error: "Source draft has no slug; set one before translating" }, 400);

  const translationConflict = db.query(
    "SELECT id FROM drafts WHERE lang = ? AND TRIM(slug) = ? LIMIT 1"
  ).get(targetLang, slug) as { id: string } | null;
  if (translationConflict) {
    return c.json({ error: "A draft with this slug already exists for the target language", conflict: translationConflict }, 409);
  }

  try {
    const allPresets = db.query("SELECT * FROM translation_presets").all() as TranslationPreset[];
    const textToSearch = [source.title, source.description, source.content].join(" ").toLowerCase();
    const relevantPresets = allPresets
      .map((p) => ({
        keywords: JSON.parse(p.keywords) as string[],
        translations: JSON.parse(p.translations) as Record<string, string>,
        note: p.note,
      }))
      .filter((p) => p.keywords.some((kw) => textToSearch.includes(kw.toLowerCase())));

    const translated = await translateDraft({
      title: source.title,
      description: source.description,
      content: source.content,
      sourceLang: source.lang,
      targetLang,
      presets: relevantPresets,
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

  const slug = (source.slug?.trim()) || slugify(source.title);
  if (!slug) return c.json({ error: "Source draft has no slug; set one before translating" }, 400);

  const translationConflict = db.query(
    "SELECT id FROM drafts WHERE lang = ? AND TRIM(slug) = ? LIMIT 1"
  ).get(targetLang, slug) as { id: string } | null;
  if (translationConflict) {
    return c.json({ error: "A draft with this slug already exists for the target language", conflict: translationConflict }, 409);
  }

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

// POST /api/drafts/:id/og-hero — temporarily store hero image on disk, return a token
api.post("/drafts/:id/og-hero", async (c) => {
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

  const MAX_BYTES = 30 * 1024 * 1024; // 30 MB
  if (heroFile.size > MAX_BYTES) return c.json({ error: "Image must be 30 MB or smaller" }, 413);

  await ensureOgTempDir();
  cleanupOldOgTemp(); // fire-and-forget cleanup

  const token = `${id}-${nanoid()}.${ext}`;
  const tempPath = `${OG_TEMP_DIR}/${token}`;
  const buffer = new Uint8Array(await heroFile.arrayBuffer());
  await Bun.write(tempPath, buffer);

  return c.json({ heroToken: token });
});

// POST /api/drafts/:id/generate-og — generate OG image from draft data and upload to R2
api.post("/drafts/:id/generate-og", async (c) => {
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
    // Sanitize token: must be filename-safe, no path traversal
    const safeToken = body.heroToken.replaceAll(/[^a-zA-Z0-9._-]/g, "");
    if (safeToken !== body.heroToken) {
      return c.json({ error: "Invalid heroToken" }, 400);
    }
    // Token must belong to this draft (prefixed with `${id}-`)
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

    // Clean up temp hero after successful generation
    if (heroTempPath) await unlink(heroTempPath).catch(() => {});

    const updatedDraft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft;
    return c.json({ success: true, ogImageUrl: ogUrl, draft: updatedDraft, ...(heroWarning ? { warning: heroWarning } : {}) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ── Translation Presets CRUD ──────────────────────────────────────────────────

// GET /api/presets
api.get("/presets", (c) => {
  const presets = db.query("SELECT * FROM translation_presets ORDER BY updated_at DESC").all() as TranslationPreset[];
  return c.json(presets);
});

// POST /api/presets
api.post("/presets", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    keywords?: string[];
    translations?: Record<string, string>;
    note?: string;
  };
  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return c.json({ error: "keywords must be a non-empty array" }, 400);
  }
  const now = new Date().toISOString();
  const id = nanoid();
  db.query(
    `INSERT INTO translation_presets (id, keywords, translations, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    JSON.stringify(body.keywords),
    JSON.stringify(body.translations ?? {}),
    body.note ?? "",
    now,
    now,
  );
  const preset = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset;
  return c.json(preset, 201);
});

// GET /api/presets/:id
api.get("/presets/:id", (c) => {
  const id = c.req.param("id");
  const preset = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset | null;
  if (!preset) return c.json({ error: "Not found" }, 404);
  return c.json(preset);
});

// PATCH /api/presets/:id
api.patch("/presets/:id", async (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset | null;
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as {
    keywords?: string[];
    translations?: Record<string, string>;
    note?: string;
  };
  const keywords = Array.isArray(body.keywords) ? JSON.stringify(body.keywords) : existing.keywords;
  const translations = body.translations == null ? existing.translations : JSON.stringify(body.translations);
  const note = body.note ?? existing.note;
  const now = new Date().toISOString();

  db.query(
    `UPDATE translation_presets SET keywords = ?, translations = ?, note = ?, updated_at = ? WHERE id = ?`
  ).run(keywords, translations, note, now, id);

  const preset = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset;
  return c.json(preset);
});

// DELETE /api/presets/:id
api.delete("/presets/:id", (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset | null;
  if (!existing) return c.json({ error: "Not found" }, 404);
  db.query("DELETE FROM translation_presets WHERE id = ?").run(id);
  return c.json({ ok: true });
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
    .replaceAll(/[\u4e00-\u9fff]+/g, "")   // remove CJK
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 50);
}

export default api;
