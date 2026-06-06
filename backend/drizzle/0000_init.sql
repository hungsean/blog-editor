CREATE TABLE `drafts` (
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
CREATE TABLE `images` (
	`key` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `translation_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
