/** 支援的文章語言代碼，順序即為 UI 下拉選單順序。 */
export const LANG_OPTIONS = ["zh-tw", "en", "ja"] as const;

/** 語言代碼對應的顯示名稱。 */
export const LANG_LABELS: Record<string, string> = {
  "zh-tw": "中文",
  en: "English",
  ja: "日本語",
};

/** 取得語言代碼的顯示名稱，未知代碼則回傳原代碼。 */
export function langLabel(lang: string): string {
  return LANG_LABELS[lang] ?? lang;
}
