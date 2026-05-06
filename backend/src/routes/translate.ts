import { Hono } from "hono";
import { db } from "../lib/db";
import { translateDraft, isTranslationEnabled } from "../lib/translator";
import type { TranslationPreset } from "../types";

const translate = new Hono();

// GET /api/translation/status
translate.get("/translation/status", (c) => {
  return c.json({ enabled: isTranslationEnabled() });
});

// POST /api/translation — translate content and return result without creating a draft
translate.post("/translation", async (c) => {
  if (!isTranslationEnabled()) {
    return c.json({ error: "AI translation is not enabled" }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as {
    title?: string;
    description?: string;
    content?: string;
    sourceLang?: string;
    targetLang?: string;
  };

  const { title, description, content, sourceLang, targetLang } = body;
  if (!title || content === undefined || !sourceLang || !targetLang) {
    return c.json({ error: "title, content, sourceLang, and targetLang are required" }, 400);
  }

  try {
    const allPresets = db.query("SELECT * FROM translation_presets").all() as TranslationPreset[];
    const textToSearch = [title, description, content].join(" ").toLowerCase();
    const relevantPresets = allPresets
      .map((p) => ({
        keywords: JSON.parse(p.keywords) as string[],
        translations: JSON.parse(p.translations) as Record<string, string>,
        note: p.note,
      }))
      .filter((p) => p.keywords.some((kw) => textToSearch.includes(kw.toLowerCase())));

    const translated = await translateDraft({
      title,
      description: description ?? "",
      content,
      sourceLang,
      targetLang,
      presets: relevantPresets,
    });

    return c.json(translated);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default translate;
