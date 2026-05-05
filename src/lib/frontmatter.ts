/**
 * ## frontmatter
 *
 * 負責解析與轉換 Markdown 文章的 YAML frontmatter。
 *
 * ### 資料流
 * 原始 .md 字串 → `parseFrontmatter` → `{ frontmatter, body }` → `frontmatterToDraft` → DB 欄位
 *
 * ### 已知限制
 * - YAML 解析為自製簡易版，僅支援 string/boolean/inline array，不支援巢狀結構或多行值
 * - 對 YAML 中的多行字串（`|` / `>`）不會正確處理，會被當成普通字串
 */
export type FrontmatterData = Record<string, string | boolean | string[]>;

const VALID_LANGS = new Set(["zh-tw", "en", "ja"]);

/**
 * 從 GitHub 檔案路徑中解析語言與 slug。
 *
 * @param path - 格式為 `src/content/blog/{lang}/{slug}.md` 的路徑
 * @returns `{ lang, slug }`；若路徑不符合預期格式，lang 預設為 `zh-tw`
 *
 * @remarks
 * 有效語言清單為 `VALID_LANGS`（目前：zh-tw / en / ja）。
 * 不在清單中的 lang segment 會觸發 fallback，slug 取自路徑最後一段。
 */
export function extractFromPath(path: string): { lang: string; slug: string } {
  const parts = path.split("/");
  if (parts.length >= 5 && VALID_LANGS.has(parts[3] ?? "")) {
    return { lang: parts[3] as string, slug: (parts[4] ?? "").replace(/\.md$/, "") };
  }
  return { lang: "zh-tw", slug: (parts[parts.length - 1] ?? "").replace(/\.md$/, "") };
}

export interface ParsedPost {
  frontmatter: FrontmatterData;
  body: string;
}

/**
 * 從原始 Markdown 字串中解析 YAML frontmatter 區塊。
 *
 * @param raw - 完整的 .md 檔案內容（包含 `---` 分隔符）
 * @returns `{ frontmatter, body }`；若無 frontmatter 則 frontmatter 為空物件，body 為原始字串
 *
 * @remarks
 * 支援的 YAML 型別：string、boolean、inline array（`["a","b"]` 或 `[a, b]`）。
 * 不支援巢狀 YAML、多行值（`|` / `>`）、或 YAML anchors。
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
 * 將已解析的 frontmatter 轉換為可存入 drafts 表格的欄位結構。
 *
 * @param fm - `parseFrontmatter` 回傳的 frontmatter 物件
 * @returns DB 欄位：title / lang / description / tags（JSON 字串）/ fields（JSON 字串）
 *
 * @remarks
 * `title`、`lang`、`description`、`tags` 為已知欄位，其餘 key 一律收進 `fields`（JSON）。
 * `tags` 若非陣列型別（例如被解析為字串），會 fallback 為 `"[]"`。
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
