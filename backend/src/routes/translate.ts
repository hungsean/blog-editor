import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../lib/db";
import { translateDraft, isTranslationEnabled } from "../lib/translator";
import { slugify } from "../lib/slugify";
import type { Draft, TranslationPreset } from "../types";

const translate = new Hono();

// GET /api/translation-status
translate.get("/translation-status", (c) => {
  return c.json({ enabled: isTranslationEnabled() });
});

// POST /api/drafts/:id/translate — manual copy with same content
translate.post("/drafts/:id/translate", async (c) => {
  const id = c.req.param("id");
  const source = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!source) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as { targetLang?: string };
  const targetLang = body.targetLang;
  if (!targetLang) return c.json({ error: "targetLang is required" }, 400);

  const slug = source.slug?.trim() || slugify(source.title);
  if (!slug) return c.json({ error: "Source draft has no slug; set one before translating" }, 400);

  const conflict = db.query(
    "SELECT id FROM drafts WHERE lang = ? AND TRIM(slug) = ? LIMIT 1"
  ).get(targetLang, slug) as { id: string } | null;
  if (conflict) {
    return c.json({ error: "A draft with this slug already exists for the target language", conflict }, 409);
  }

  const now = new Date().toISOString();
  const newId = nanoid();

  db.query(
    `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?)`
  ).run(newId, source.title, targetLang, slug, source.description, source.tags, source.fields, source.content, now, now);

  const newDraft = db.query("SELECT * FROM drafts WHERE id = ?").get(newId) as Draft;
  return c.json(newDraft, 201);
});

// POST /api/drafts/:id/ai-translate — OpenAI-translated copy
translate.post("/drafts/:id/ai-translate", async (c) => {
  const id = c.req.param("id");
  const source = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft | null;
  if (!source) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as { targetLang?: string };
  const targetLang = body.targetLang;
  if (!targetLang) return c.json({ error: "targetLang is required" }, 400);

  const slug = source.slug?.trim() || slugify(source.title);
  if (!slug) return c.json({ error: "Source draft has no slug; set one before translating" }, 400);

  const conflict = db.query(
    "SELECT id FROM drafts WHERE lang = ? AND TRIM(slug) = ? LIMIT 1"
  ).get(targetLang, slug) as { id: string } | null;
  if (conflict) {
    return c.json({ error: "A draft with this slug already exists for the target language", conflict }, 409);
  }

  try {
    const allPresets = db.query("SELECT * FROM translation_presets").all() as TranslationPreset[];
    const textToSearch = [source.title, source.description, source.content].join(" ").toLowerCase();
    const relevantPresets = allPresets
      .map((p) => ({
        keywords: JSON.parse(p.keywords) as string[],
        translations: JSON.parse(p.translations) as Record<string, string>,
        note: p.note,
      }))
      .filter((p) => p.keywords.some((kw) => textToSearch.includes(kw.toLowerCase())));

    const translated = await translateDraft({
      title: source.title,
      description: source.description,
      content: source.content,
      sourceLang: source.lang,
      targetLang,
      presets: relevantPresets,
    });

    const now = new Date().toISOString();
    const newId = nanoid();

    db.query(
      `INSERT INTO drafts (id, title, lang, slug, description, tags, fields, content, status, pr_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?)`
    ).run(newId, translated.title, targetLang, slug, translated.description, source.tags, source.fields, translated.content, now, now);

    const newDraft = db.query("SELECT * FROM drafts WHERE id = ?").get(newId) as Draft;
    return c.json(newDraft, 201);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default translate;
