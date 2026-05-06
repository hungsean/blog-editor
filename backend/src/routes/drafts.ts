import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { getGithubFile } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft } from "../lib/frontmatter";
import type { Draft } from "../types";

const drafts = new Hono();

// GET /api/drafts
drafts.get("/drafts", (c) => {
  const rows = db
    .query("SELECT id, title, lang, slug, status, pr_url, github_path, github_sha, created_at, updated_at FROM drafts ORDER BY DATE(json_extract(fields, '$.pubDate')) DESC, updated_at DESC")
    .all() as Draft[];
  return c.json(rows);
});

// POST /api/drafts
drafts.post("/drafts", async (c) => {
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
drafts.get("/drafts/:id", (c) => {
  const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(c.req.param("id")) as Draft | null;
  if (!draft) return c.json({ error: "Not found" }, 404);
  return c.json(draft);
});

// PATCH /api/drafts/:id
drafts.patch("/drafts/:id", async (c) => {
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
drafts.delete("/drafts/:id", (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT id FROM drafts WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  db.query("DELETE FROM drafts WHERE id = ?").run(id);
  return c.json({ success: true });
});

// POST /api/drafts/:id/resync
drafts.post("/drafts/:id/resync", async (c) => {
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

// GET /api/drafts/:id/translations
drafts.get("/drafts/:id/translations", (c) => {
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

export default drafts;
