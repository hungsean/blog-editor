/**
 * ## frontmatter
 *
 * 負責解析與轉換 Markdown 文章的 YAML frontmatter。
 *
 * ### 資料流
 * 原始 .md 字串 → `parseFrontmatter` → `{ frontmatter, body }` → `frontmatterToDraft` → DB 欄位
 *
 * ### 設計決策
 * - 解析與序列化都用 `yaml` library：序列化在 `routes/drafts.ts` 的 `buildFrontmatter`，
 *   解析在此處的 `parseFrontmatter`。兩端共用同一套 YAML 語意，publish 出去的多行字串
 *   （`|-` 區塊）與 quote/escape 才能在 sync/resync 時正確讀回，不會只改輸出端就讀壞。
 */
import { parse as parseYaml } from "yaml";

/** 解析後的 frontmatter；值的型別由 YAML 內容決定（string/boolean/number/array/物件）。 */
export type FrontmatterData = Record<string, unknown>;

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
 * frontmatter 區塊用 `yaml` library 解析，支援多行字串（`|` / `>`）、巢狀結構等完整
 * YAML 語意。YAML 不合法時 `yaml.parse` 會拋出例外，刻意不在此捕捉 —— 由呼叫端
 * （resync / sync route）回報錯誤，而非靜默吞掉導致 title 等欄位被清空。
 */
export function parseFrontmatter(raw: string): ParsedPost {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";
  const parsed = parseYaml(yamlBlock) as unknown;
  // 空 frontmatter（parseYaml 回傳 null）或頂層非 mapping 一律視為空物件。
  const frontmatter: FrontmatterData =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as FrontmatterData)
      : {};

  return { frontmatter, body: body.trimStart() };
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
