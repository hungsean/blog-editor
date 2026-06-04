import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import {
  listSyncedGithubPaths,
  getDraftByGithubPath,
  createDraft,
  updateDraft,
} from "../lib/repos/drafts";
import { getGithubFile, listGithubPosts } from "../lib/github";
import { parseFrontmatter, frontmatterToDraft, extractFromPath } from "../lib/frontmatter";

const github = new Hono();

// GET /api/github/posts
github.get("/github/posts", async (c) => {
  try {
    const posts = await listGithubPosts();
    const syncedPaths = new Set(await listSyncedGithubPaths(db));
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

      const existing = await getDraftByGithubPath(db, path);

      if (existing) {
        if (!force && existing.github_sha === sha) continue;
        await updateDraft(db, existing.id, {
          title, lang, slug, description, tags, fields, content: mdBody, github_sha: sha, updated_at: now,
        });
        updated.push(path);
      } else {
        await createDraft(db, {
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
