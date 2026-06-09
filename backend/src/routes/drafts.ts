import { Hono } from "hono";
import { nanoid } from "nanoid";
import { Document, visit } from "yaml";
import type { AppEnv } from "../app";
import {
  listDrafts,
  getDraftById,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteDrafts,
  findSlugConflict,
  findSlugConflictExcludingIds,
} from "../lib/repos/drafts";
import { createGithub } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft } from "../lib/frontmatter";
import { slugify, isValidSlug, SLUG_PATTERN } from "../lib/slugify";
import type { Draft } from "../types";

const drafts = new Hono<AppEnv>();

/**
 * 將 draft 的 frontmatter 欄位序列化為 YAML 字串。
 *
 * @returns `{ frontmatter, date, slug }` — frontmatter 為含結尾換行的 YAML 區塊
 *
 * @remarks
 * 使用 `yaml` library 序列化，由它負責 quote/escape：標題或描述含 `:`、`#`、引號、
 * 換行等 YAML 特殊字元時都能產出合法輸出，不會壞掉 frontmatter。
 * 陣列強制以 flow 樣式（`[a, b]`）輸出，讓產出的 frontmatter 更接近既有格式；
 * `parseFrontmatter` 同樣使用 `yaml` library，因此 flow / block array 都能讀回。
 *
 * `toString` 以 `defaultStringType: "QUOTE_DOUBLE"` 強制所有字串「值」一律用雙引號
 * 包住（issue #29），避免輸出隨內容在裸值 / 帶引號間擺盪，讓 frontmatter 格式統一、
 * 可預期。必須同時設 `defaultKeyType: "PLAIN"`，否則 key 會跟著 `defaultStringType`
 * 一起被引號包住（`"title":`），這不是我們要的。
 */
function buildFrontmatter(draft: Draft): { frontmatter: string; date: string; slug: string } {
  const fields = JSON.parse(draft.fields || "{}");
  const tags = JSON.parse(draft.tags || "[]");
  const date = typeof fields.pubDate === "string" && fields.pubDate
    ? fields.pubDate
    : new Date().toISOString().slice(0, 10);
  const slug = draft.slug?.trim() || slugify(draft.title);

  const { lang: _lang, ...fieldsWithoutLang } = fields;
  const fm: Record<string, unknown> = { title: draft.title, pubDate: date };
  if (draft.description) fm.description = draft.description;
  if (Array.isArray(tags) && tags.length > 0) fm.tags = tags;
  Object.assign(fm, fieldsWithoutLang);

  const doc = new Document(fm);
  visit(doc, { Seq: (_key, node) => { node.flow = true; } });
  const frontmatter = doc.toString({
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  });

  return { frontmatter, date, slug };
}

/** pubDate 必須是 `YYYY-MM-DD` 格式。 */
const PUB_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 驗證 publish 用的 slug 與 pubDate。
 *
 * @returns 錯誤訊息字串；通過驗證則為 `null`
 *
 * @remarks
 * slug 與 date 會直接組進 GitHub 檔案路徑與 branch 名稱，必須在後端強制白名單，
 * 不能信任前端傳來的值。date 除了格式還會檢查是否為真實存在的日曆日期。
 */
function validatePublishFields(slug: string, date: string): string | null {
  if (!isValidSlug(slug)) {
    return `slug "${slug}" 格式不合法，必須符合 ${SLUG_PATTERN.source}`;
  }
  if (!PUB_DATE_PATTERN.test(date)) {
    return `pubDate "${date}" 格式不合法，必須為 YYYY-MM-DD`;
  }
  const ts = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ts) || new Date(ts).toISOString().slice(0, 10) !== date) {
    return `pubDate "${date}" 不是有效日期`;
  }
  return null;
}

/** 依 lang/slug 推算 publish 後文章在 GitHub 的檔案路徑。 */
function expectedGithubPath(lang: string, slug: string): string {
  return `src/content/blog/${lang}/${slug}.md`;
}

// GET /api/drafts
drafts.get("/drafts", async (c) => {
  const rows = await listDrafts(c.var.db);
  return c.json(rows);
});

/**
 * POST /api/drafts —— 建立新草稿。
 *
 * @remarks
 * 未帶 `fields` 時（前端 New Post 送的是空 body），預設塞入今天作為 `pubDate`，
 * 讓新草稿一進編輯器就帶有預設發布日。日期取自此 handler 已算好的 `now`（UTC），
 * 與前端 editor.tsx 的初始預設一致，避免兩邊時區行為分歧。
 */
drafts.post("/drafts", async (c) => {
  const now = new Date().toISOString();
  const id = nanoid();
  const body = await c.req.json().catch(() => ({})) as Partial<Draft>;

  const draft = await createDraft(c.var.db, {
    id,
    title: body.title ?? "",
    lang: body.lang ?? "zh-tw",
    slug: body.slug?.trim() ?? "",
    description: body.description ?? "",
    tags: body.tags ?? "[]",
    fields: body.fields ?? JSON.stringify({ pubDate: now.slice(0, 10) }),
    content: body.content ?? "",
    status: "draft",
    pr_url: "",
    created_at: now,
    updated_at: now,
  });
  return c.json(draft, 201);
});

// POST /api/drafts/publish (batch) — must be before /drafts/:id/publish to avoid :id matching "publish"
drafts.post("/drafts/publish", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { draftIds?: string[] };
  if (!Array.isArray(body.draftIds) || body.draftIds.length === 0) {
    return c.json({ error: "draftIds is required" }, 400);
  }

  const draftList = (await Promise.all(body.draftIds.map((id) => getDraftById(c.var.db, id))))
    .filter((d): d is Draft => d !== null);

  if (draftList.length === 0) return c.json({ error: "No valid drafts found" }, 404);

  const resolved = draftList.map((d) => ({ draft: d, slug: d.slug?.trim() || slugify(d.title) }));

  const emptySlugDrafts = resolved.filter((r) => !r.slug);
  if (emptySlugDrafts.length > 0) {
    return c.json({
      success: false,
      reason: "slug_required",
      error: "Some drafts are missing a slug",
      drafts: emptySlugDrafts.map((r) => ({ id: r.draft.id, title: r.draft.title })),
    }, 400);
  }

  // Check internal duplicates within batch (same lang + slug)
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

  const batchIds = draftList.map((d) => d.id);
  const dbConflicts: object[] = [];
  for (const { draft, slug } of resolved) {
    if (batchKeys.get(`${draft.lang}:${slug}`)!.length > 1) continue;
    const conflict = await findSlugConflictExcludingIds(c.var.db, draft.lang, slug, batchIds);
    if (conflict) {
      dbConflicts.push({ type: "existing_draft", lang: draft.lang, slug, draft: { id: draft.id, title: draft.title }, conflict });
    }
  }

  const allConflicts = [...internalConflicts, ...dbConflicts];
  if (allConflicts.length > 0) {
    return c.json({ success: false, reason: "slug_conflicts", error: "Slug conflicts found", conflicts: allConflicts }, 400);
  }

  const built = resolved.map(({ draft, slug }) => {
    const { frontmatter, date } = buildFrontmatter(draft);
    return { draft, slug, frontmatter, date };
  });

  const invalidFields = built
    .map(({ draft, slug, date }) => {
      const error = validatePublishFields(slug, date);
      return error ? { id: draft.id, title: draft.title, error } : null;
    })
    .filter((x): x is { id: string; title: string; error: string } => x !== null);
  if (invalidFields.length > 0) {
    return c.json({
      success: false,
      reason: "invalid_fields",
      error: "Some drafts have an invalid slug or pubDate",
      drafts: invalidFields,
    }, 400);
  }

  const files = built.map(({ draft, slug, frontmatter, date }) => ({
    title: draft.title,
    slug,
    lang: draft.lang,
    date,
    frontmatter,
    content: draft.content,
    githubPath: draft.github_path || undefined,
    githubSha: draft.github_sha || undefined,
  }));

  try {
    const { prUrl } = await createGithub(c.var.env.github).openBatchPR(files);
    const now = new Date().toISOString();
    for (const { draft, slug } of built) {
      // 保存每篇 draft 的 resolved slug 與 expected path：批次 PR 內含多篇 .md，
      // prChecker 必須靠這個 path 精準對應，否則所有 draft 會被標成同一個檔案。
      const githubPath = draft.github_path || expectedGithubPath(draft.lang, slug);
      await updateDraft(c.var.db, draft.id, {
        status: "pr_opened", pr_url: prUrl, slug, github_path: githubPath, updated_at: now,
      });
    }
    return c.json({ success: true, pr_url: prUrl, count: draftList.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /api/drafts/:id
drafts.get("/drafts/:id", async (c) => {
  const draft = await getDraftById(c.var.db, c.req.param("id"));
  if (!draft) return c.json({ error: "Not found" }, 404);
  return c.json(draft);
});

// PATCH /api/drafts/:id
drafts.patch("/drafts/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getDraftById(c.var.db, id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as Partial<Draft>;
  const now = new Date().toISOString();

  const draft = await updateDraft(c.var.db, id, {
    title:       body.title       ?? existing.title,
    lang:        body.lang        ?? existing.lang,
    slug:        body.slug !== undefined ? body.slug.trim() : existing.slug,
    description: body.description ?? existing.description,
    tags:        body.tags        ?? existing.tags,
    fields:      body.fields      ?? existing.fields,
    content:     body.content     ?? existing.content,
    updated_at:  now,
  });
  return c.json(draft);
});

// DELETE /api/drafts (batch)
drafts.delete("/drafts", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { draftIds?: string[] };
  if (!Array.isArray(body.draftIds) || body.draftIds.length === 0) {
    return c.json({ error: "draftIds is required" }, 400);
  }

  const deleted = await deleteDrafts(c.var.db, body.draftIds);
  return c.json({ success: true, deleted, count: deleted.length });
});

// DELETE /api/drafts/:id
drafts.delete("/drafts/:id", async (c) => {
  const id = c.req.param("id");
  const existed = await deleteDraft(c.var.db, id);
  if (!existed) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

// POST /api/drafts/:id/publish
drafts.post("/drafts/:id/publish", async (c) => {
  const id = c.req.param("id");
  const draft = await getDraftById(c.var.db, id);
  if (!draft) return c.json({ error: "Not found" }, 404);

  const { frontmatter, date, slug } = buildFrontmatter(draft);
  if (!slug) {
    return c.json({ success: false, reason: "required", error: "Slug is required" }, 400);
  }

  const fieldError = validatePublishFields(slug, date);
  if (fieldError) {
    return c.json({ success: false, reason: "invalid", error: fieldError }, 400);
  }

  const slugConflict = await findSlugConflict(c.var.db, draft.lang, slug, id);
  if (slugConflict) {
    return c.json({ success: false, reason: "conflict", error: "Slug already exists in this language", conflict: slugConflict }, 400);
  }

  try {
    const { prUrl, filePath } = await createGithub(c.var.env.github).openPR({
      title: draft.title,
      slug,
      lang: draft.lang,
      date,
      frontmatter,
      content: draft.content,
      githubPath: draft.github_path || undefined,
      githubSha: draft.github_sha || undefined,
    });

    // 寫回 resolved slug（可能來自 slugify fallback）與 expected path，
    // 讓列表顯示正確 slug、prChecker 能精準對應 PR 檔案。
    await updateDraft(c.var.db, id, {
      status: "pr_opened", pr_url: prUrl, slug, github_path: filePath, updated_at: new Date().toISOString(),
    });

    return c.json({ success: true, pr_url: prUrl });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/drafts/:id/resync
drafts.post("/drafts/:id/resync", async (c) => {
  const id = c.req.param("id");
  const draft = await getDraftById(c.var.db, id);
  if (!draft) return c.json({ error: "Not found" }, 404);
  if (!draft.github_path) return c.json({ error: "This draft has no GitHub source" }, 400);

  try {
    const { content, sha } = await createGithub(c.var.env.github).getGithubFile(draft.github_path);
    const { frontmatter: fm, body: mdBody } = parseFrontmatter(content);
    const { title, lang, description, tags, fields } = frontmatterToDraft(fm);
    const now = new Date().toISOString();

    const updated = await updateDraft(c.var.db, id, {
      title, lang, description, tags, fields, content: mdBody, github_sha: sha, updated_at: now,
    });
    return c.json(updated);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default drafts;
