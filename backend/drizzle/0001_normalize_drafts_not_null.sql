-- 收斂舊 self-host DB 的 drafts schema：把 description/tags/fields/content/pr_url/
-- github_path/github_sha/slug 由 nullable 改為 NOT NULL，對齊 0000_init（clean DB / D1）。
--
-- 背景：舊 applySchema 這些欄位只有 DEFAULT '' 而無 NOT NULL，baseline 只標記
-- __drizzle_migrations、不改實體 schema，導致舊 DB 與 clean DB/D1 的 NOT NULL 約束漂移。
-- SQLite 無法直接 ALTER COLUMN 加 NOT NULL，故走標準的 table rebuild（12-step）。
-- COALESCE 把任何殘留 NULL 補回各欄位 default，避免重建時違反 NOT NULL。
--
-- 對 clean DB / D1（欄位本已 NOT NULL、無 NULL 值）此 migration 為等價重建，安全無副作用。
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`lang` text DEFAULT 'zh-tw' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`pr_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`github_path` text DEFAULT '' NOT NULL,
	`github_sha` text DEFAULT '' NOT NULL,
	`slug` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_drafts` (
	`id`, `title`, `lang`, `description`, `tags`, `fields`, `content`,
	`status`, `pr_url`, `created_at`, `updated_at`, `github_path`, `github_sha`, `slug`
)
SELECT
	`id`,
	`title`,
	`lang`,
	COALESCE(`description`, ''),
	COALESCE(`tags`, '[]'),
	COALESCE(`fields`, '{}'),
	COALESCE(`content`, ''),
	`status`,
	COALESCE(`pr_url`, ''),
	`created_at`,
	`updated_at`,
	COALESCE(`github_path`, ''),
	COALESCE(`github_sha`, ''),
	COALESCE(`slug`, '')
FROM `drafts`;--> statement-breakpoint
DROP TABLE `drafts`;--> statement-breakpoint
ALTER TABLE `__new_drafts` RENAME TO `drafts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
