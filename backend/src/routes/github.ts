import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { AppEnv } from "../app";
import {
  listSyncedGithubPaths,
  getDraftByGithubPath,
  createDraft,
  updateDraft,
} from "../lib/repos/drafts";
import { createGithub } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft, extractFromPath } from "../lib/frontmatter";

const github = new Hono<AppEnv>();

// GET /api/github/posts
github.get("/github/posts", async (c) => {
  try {
    const posts = await createGithub(c.var.env.github).listGithubPosts();
    const syncedPaths = new Set(await listSyncedGithubPaths(c.var.db));
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
  const gh = createGithub(c.var.env.github);

  const imported: string[] = [];
  const updated: string[] = [];
  const errors: string[] = [];

  for (const path of body.paths) {
    try {
      const { content, sha } = await gh.getGithubFile(path);
      const { frontmatter: fm, body: mdBody } = parseFrontmatter(content);
      const { title, description, tags, fields } = frontmatterToDraft(fm);
      const { lang, slug } = extractFromPath(path);
      const now = new Date().toISOString();

      const existing = await getDraftByGithubPath(c.var.db, path);

      if (existing) {
        if (!force && existing.github_sha === sha) continue;
        await updateDraft(c.var.db, existing.id, {
          title, lang, slug, description, tags, fields, content: mdBody, github_sha: sha, updated_at: now,
        });
        updated.push(path);
      } else {
        await createDraft(c.var.db, {
          id: nanoid(),
          title, lang, slug, description, tags, fields, content: mdBody,
          status: "published", pr_url: "", github_path: path, github_sha: sha,
          created_at: now, updated_at: now,
        });
        imported.push(path);
      }
    } catch (err) {
      errors.push(`${path}: ${String(err)}`);
    }
  }

  return c.json({ imported, updated, errors });
});

export default github;
