import { Hono } from "hono";
import { db } from "../lib/db";
import { findDraftsBySlug } from "../lib/repos/drafts";

const slug = new Hono();

// GET /api/slug?slug=xxx[&lang=yyy]
// Returns drafts with the same slug. If lang is provided, filters to that language only.
slug.get("/slug", async (c) => {
  const slugParam = (c.req.query("slug") ?? "").trim();
  if (!slugParam) return c.json({ error: "slug is required" }, 400);

  const lang = c.req.query("lang");
  const matches = await findDraftsBySlug(db, slugParam, lang);
  return c.json(matches);
});

export default slug;
