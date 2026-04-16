import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { getPostSchema, forceRefreshSchema, openPR, listGithubPosts, getGithubFile } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft } from "../lib/frontmatter";

type Draft = {
  id: string;
  title: string;
  lang: string;
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

// GET /api/schema
api.get("/schema", async (c) => {
  const schema = await getPostSchema();
  return c.json(schema);
});

// POST /api/schema/refresh
api.post("/schema/refresh", async (c) => {
  const schema = await forceRefreshSchema();
  return c.json(schema);
});

// GET /api/drafts
api.get("/drafts", (c) => {
  const drafts = db
    .query("SELECT id, title, lang, status, pr_url, created_at, updated_at FROM drafts ORDER BY updated_at DESC")
    .all() as Draft[];
  return c.json(drafts);
});

// POST /api/drafts
api.post("/drafts", async (c) => {
  const now = new Date().toISOString();
  const id = nanoid();
  const body = await c.req.json().catch(() => ({})) as Partial<Draft>;

  db.query(
    `INSERT INTO drafts (id, title, lang, description, tags, fields, content, status, pr_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?)`
  ).run(
    id,
    body.title ?? "",
    body.lang ?? "zh-tw",
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
      description = ?,
      tags        = ?,
      fields      = ?,
      content     = ?,
      updated_at  = ?
    WHERE id = ?`
  ).run(
    body.title       ?? existing.title,
    body.lang        ?? existing.lang,
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
  const slug = slugify(draft.title) || id;

  // Build frontmatter
  const fm: Record<string, unknown> = {
    title: draft.title,
    lang: draft.lang,
    pubDate: date,
  };
  if (draft.description) fm.description = draft.description;
  if (tags.length > 0) fm.tags = tags;
  Object.assign(fm, fields);

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
      const { title, lang, description, tags, fields } = frontmatterToDraft(fm);
      const now = new Date().toISOString();

      // Check if already synced
      const existing = db.query("SELECT id FROM drafts WHERE github_path = ?").get(path) as { id: string } | null;

      if (existing) {
        db.query(
          `UPDATE drafts SET title=?, lang=?, description=?, tags=?, fields=?, content=?, github_sha=?, updated_at=? WHERE id=?`
        ).run(title, lang, description, tags, fields, mdBody, sha, now, existing.id);
        updated.push(path);
      } else {
        const newId = nanoid();
        db.query(
          `INSERT INTO drafts (id, title, lang, description, tags, fields, content, status, pr_url, github_path, github_sha, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?, 'github', ?, ?)`
        ).run(newId, title, lang, description, tags, fields, mdBody, path, sha, now, now);
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, "")   // remove CJK
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export default api;
