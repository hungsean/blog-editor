/**
 * 將文字轉換為 URL 安全的 slug。
 *
 * @remarks
 * 只保留英文字母與數字，其餘字元（含 CJK、空白、標點）一律替換為 `-`。
 * 純中文標題會產生空字串，呼叫端需自行 fallback（通常為阻擋送出）。
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 50);
}
