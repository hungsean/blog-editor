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

/**
 * 合法 slug 的格式：小寫英數字，以單一連字號分隔，不允許前後或連續連字號。
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 檢查 slug 是否符合 publish 允許的格式。
 *
 * @remarks
 * publish 時 slug 會直接組進 GitHub 檔案路徑與 branch 名稱，若含 `/`、空白或
 * 特殊字元會造成巢狀路徑、invalid ref 或 publish 失敗。`slugify` 的輸出永遠
 * 通過此檢查；真正需要把關的是使用者手動輸入的 slug。
 */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
