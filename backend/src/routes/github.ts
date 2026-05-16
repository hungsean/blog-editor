import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { getGithubFile, listGithubPosts } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft, extractFromPath } from "../lib/frontmatter";

const github = new Hono();

// GET /api/github/posts
github.get("/github/posts", async (c) => {
  try {
    const posts = await listGithubPosts();
    const syncedPaths = new Set(
      (db.query("SELECT github_path FROM drafts WHERE github_path != ''").all() as { github_path: string }[])
        .map((r) => r.github_path)
    );
    return c.json(posts.map((p) => ({ ...p, synced: syncedPaths.has(p.path) })));
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/github/sync
github.post("/github/sync", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { paths?: string[]; force?: boolean };
  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return c.json({ error: "paths is required" }, 400);
  }
  const force = body.force === true;

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

      const existing = db.query("SELECT id, github_sha FROM drafts WHERE github_path = ?").get(path) as { id: string; github_sha: string } | null;

      if (existing) {
        if (!force && existing.github_sha === sha) continue;
        db.query(
          `UPDATE drafts SET title=?, lang=?, slug=?, description=?, tags=?, fields=?, content=?, github_sha=?, updated_at=? WHERE id=?`
        ).run(title, lang, slug, description, tags, fields, mdBody, sha, now, existing.id);
        updated.push(path);
      } else {
        const newId = nanoid();
        db.query(
          `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, github_path, github_sha, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', '', ?, ?, ?, ?)`
        ).run(newId, title, lang, slug, description, tags, fields, mdBody, path, sha, now, now);
        imported.push(path);
      }
    } catch (err) {
      errors.push(`${path}: ${String(err)}`);
    }
  }

  return c.json({ imported, updated, errors });
});

export default github;
