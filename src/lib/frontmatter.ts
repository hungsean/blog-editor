export type FrontmatterData = Record<string, string | boolean | string[]>;

export interface ParsedPost {
  frontmatter: FrontmatterData;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Supports: string, boolean, inline arrays (["a", "b"] or [a, b])
 */
export function parseFrontmatter(raw: string): ParsedPost {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";
  const frontmatter: FrontmatterData = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const raw_value = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    frontmatter[key] = parseYamlValue(raw_value);
  }

  return { frontmatter, body: body.trimStart() };
}

function parseYamlValue(val: string): string | boolean | string[] {
  if (val === "true") return true;
  if (val === "false") return false;

  // Inline array: ["a", "b"] or [a, b]
  if (val.startsWith("[") && val.endsWith("]")) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) =>
      s.trim().replace(/^["']|["']$/g, "")
    );
  }

  // Strip surrounding quotes
  return val.replace(/^["']|["']$/g, "");
}

/**
 * Extract known draft fields from parsed frontmatter.
 * Returns fields ready to insert into the drafts table.
 */
export function frontmatterToDraft(fm: FrontmatterData): {
  title: string;
  lang: string;
  description: string;
  tags: string;
  fields: string;
} {
  const knownKeys = new Set(["title", "lang", "description", "tags"]);
  const title = String(fm.title ?? "");
  const lang = String(fm.lang ?? "zh-tw");
  const description = String(fm.description ?? "");
  const tags = Array.isArray(fm.tags) ? JSON.stringify(fm.tags) : "[]";

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!knownKeys.has(k)) extra[k] = v;
  }

  return { title, lang, description, tags, fields: JSON.stringify(extra) };
}
