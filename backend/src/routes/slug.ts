import { Hono } from "hono";
import { db } from "../lib/db";

const slug = new Hono();

// GET /api/slug?slug=xxx[&lang=yyy]
// Returns drafts with the same slug. If lang is provided, filters to that language only.
slug.get("/slug", (c) => {
  const slugParam = (c.req.query("slug") ?? "").trim();
  if (!slugParam) return c.json({ error: "slug is required" }, 400);

  const lang = c.req.query("lang");

  const matches = lang
    ? db.query(
        "SELECT id, title, lang, slug, status, github_path FROM drafts WHERE lang = ? AND TRIM(slug) = ?"
      ).all(lang, slugParam)
    : db.query(
        "SELECT id, title, lang, slug, status, github_path FROM drafts WHERE TRIM(slug) = ?"
      ).all(slugParam);

  return c.json(matches);
});

export default slug;
