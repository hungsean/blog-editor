import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { AppEnv } from "../app";
import {
  listPresets,
  getPresetById,
  createPreset,
  updatePreset,
  deletePreset,
} from "../lib/repos/presets";

const presets = new Hono<AppEnv>();

// GET /api/presets
presets.get("/presets", async (c) => {
  const rows = await listPresets(c.var.db);
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
  const preset = await createPreset(c.var.db, {
    id: nanoid(),
    keywords: JSON.stringify(body.keywords),
    translations: JSON.stringify(body.translations ?? {}),
    note: body.note ?? "",
    created_at: now,
    updated_at: now,
  });
  return c.json(preset, 201);
});

// GET /api/presets/:id
presets.get("/presets/:id", async (c) => {
  const preset = await getPresetById(c.var.db, c.req.param("id"));
  if (!preset) return c.json({ error: "Not found" }, 404);
  return c.json(preset);
});

// PATCH /api/presets/:id
presets.patch("/presets/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getPresetById(c.var.db, id);
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

  const preset = await updatePreset(c.var.db, id, { keywords, translations, note, updated_at: now });
  return c.json(preset);
});

// DELETE /api/presets/:id
presets.delete("/presets/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deletePreset(c.var.db, id);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

export default presets;
