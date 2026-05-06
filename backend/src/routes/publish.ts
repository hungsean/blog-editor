import { Hono } from "hono";
import { db } from "../lib/db";
import { openPR, openBatchPR } from "../lib/github";
import { slugify } from "../lib/slugify";
import type { Draft } from "../types";

const publish = new Hono();

/** Serialize a draft's frontmatter fields into a YAML-like string. */
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
  if (tags.length > 0) fm.tags = tags;
  Object.assign(fm, fieldsWithoutLang);

  const frontmatter = Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((x) => `"${x}"`).join(", ")}]`;
      if (typeof v === "boolean") return `${k}: ${v}`;
      return `${k}: ${String(v)}`;
    })
    .join("\n") + "\n";

  return { frontmatter, date, slug };
}

// POST /api/drafts/:id/publish
publish.post("/drafts/:id/publish", async (c) => {
  const id = c.req.param("id");
  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!draft) return c.json({ error: "Not found" }, 404);

  const { frontmatter, date, slug } = buildFrontmatter(draft);
  if (!slug) {
    return c.json({ success: false, reason: "required", error: "Slug is required" }, 400);
  }

  const slugConflict = db.query(
    "SELECT id, title, lang, slug, status, github_path FROM drafts WHERE lang = ? AND TRIM(slug) = ? AND id != ? LIMIT 1"
  ).get(draft.lang, slug, id) as { id: string; title: string; lang: string; slug: string; status: string; github_path: string } | null;
  if (slugConflict) {
    return c.json({ success: false, reason: "conflict", error: "Slug already exists in this language", conflict: slugConflict }, 400);
  }

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

    db.query("UPDATE drafts SET status = 'pr_opened', pr_url = ?, updated_at = ? WHERE id = ?")
      .run(prUrl, new Date().toISOString(), id);

    return c.json({ success: true, pr_url: prUrl });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/batch-publish
publish.post("/batch-publish", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { draftIds?: string[] };
  if (!Array.isArray(body.draftIds) || body.draftIds.length === 0) {
    return c.json({ error: "draftIds is required" }, 400);
  }

  const drafts = body.draftIds
    .map((id) => db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null)
    .filter((d): d is Draft => d !== null);

  if (drafts.length === 0) return c.json({ error: "No valid drafts found" }, 404);

  const resolved = drafts.map((d) => ({ draft: d, slug: d.slug?.trim() || slugify(d.title) }));

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

  const batchIds = drafts.map((d) => d.id);
  const placeholders = batchIds.map(() => "?").join(",");
  const dbConflicts: object[] = [];
  for (const { draft, slug } of resolved) {
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

  const files = resolved.map(({ draft, slug }) => {
    const { frontmatter, date } = buildFrontmatter(draft);
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

// POST /api/batch-delete
publish.post("/batch-delete", async (c) => {
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

export default publish;
