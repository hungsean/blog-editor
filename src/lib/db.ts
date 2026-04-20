import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../../data/blog-editor.db");

// Ensure data directory exists
const dataDir = join(import.meta.dir, "../../data");
await Bun.write(join(dataDir, ".gitkeep"), "").catch(() => {});

export const db = new Database(DB_PATH, { create: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    lang        TEXT NOT NULL DEFAULT 'zh-tw',
    description TEXT DEFAULT '',
    tags        TEXT DEFAULT '[]',
    fields      TEXT DEFAULT '{}',
    content     TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    pr_url      TEXT DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )
`);

// Migrations: add new columns if they don't exist
for (const [col, def] of [
  ["github_path", "TEXT DEFAULT ''"],
  ["github_sha",  "TEXT DEFAULT ''"],
  ["source",      "TEXT DEFAULT 'local'"],
  ["slug",        "TEXT DEFAULT ''"],
] as const) {
  try {
    db.exec(`ALTER TABLE drafts ADD COLUMN ${col} ${def}`);
  } catch {
    // Column already exists, ignore
  }
}
