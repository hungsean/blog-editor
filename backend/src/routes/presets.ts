import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import type { TranslationPreset } from "../types";

const presets = new Hono();

// GET /api/presets
presets.get("/presets", (c) => {
  const rows = db.query("SELECT * FROM translation_presets ORDER BY updated_at DESC").all() as TranslationPreset[];
  return c.json(rows);
});

// POST /api/presets
presets.post("/presets", async (c) => {
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
presets.get("/presets/:id", (c) => {
  const id = c.req.param("id");
  const preset = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset | null;
  if (!preset) return c.json({ error: "Not found" }, 404);
  return c.json(preset);
});

// PATCH /api/presets/:id
presets.patch("/presets/:id", async (c) => {
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
presets.delete("/presets/:id", (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT * FROM translation_presets WHERE id = ?").get(id) as TranslationPreset | null;
  if (!existing) return c.json({ error: "Not found" }, 404);
  db.query("DELETE FROM translation_presets WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export default presets;
