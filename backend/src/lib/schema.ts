/**
 * ## schema
 *
 * Drizzle ORM 的 table 定義，對齊 `db.ts` 啟動時建立的 SQLite DDL。
 *
 * @remarks
 * repo 層（`lib/repos/`）只 import 此檔的 table 定義與推導型別，**不 import db 單例**，
 * 以維持 DB 注入契約（db 一律由呼叫端當第一參數傳入）。
 *
 * 欄位型別刻意對齊現有 DDL：
 * - `fields`、`tags`、`keywords`、`translations` 等以 JSON 字串存放，沿用 `text`，
 *   序列化 / 反序列化邏輯仍由呼叫端負責，schema 不介入。
 * - `drafts` 的 `github_path` / `github_sha` / `slug` 為後續 migration 加的欄位，
 *   在現有 DB 上由 `db.ts` 的 ALTER TABLE 補上，預設皆為空字串。
 */
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  lang: text("lang").notNull().default("zh-tw"),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  fields: text("fields").notNull().default("{}"),
  content: text("content").notNull().default(""),
  status: text("status").notNull().default("draft"),
  pr_url: text("pr_url").notNull().default(""),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  github_path: text("github_path").notNull().default(""),
  github_sha: text("github_sha").notNull().default(""),
  slug: text("slug").notNull().default(""),
});

export const translationPresets = sqliteTable("translation_presets", {
  id: text("id").primaryKey(),
  keywords: text("keywords").notNull().default("[]"),
  translations: text("translations").notNull().default("{}"),
  note: text("note").notNull().default(""),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const images = sqliteTable("images", {
  key: text("key").primaryKey(),
  url: text("url").notNull(),
  size: integer("size").notNull().default(0),
  uploaded_at: text("uploaded_at").notNull(),
});

/** drafts 列的完整查詢型別（Drizzle 推導，取代散落的 `as Draft`）。 */
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;

export type TranslationPreset = typeof translationPresets.$inferSelect;
export type NewTranslationPreset = typeof translationPresets.$inferInsert;

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
