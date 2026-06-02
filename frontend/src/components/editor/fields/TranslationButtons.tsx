import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { fetchDrafts } from "../../../lib/api/drafts";
import { fetchTranslationStatus } from "../../../lib/api/translation";
import { LANG_OPTIONS, langLabel } from "../../../lib/langs";
import TranslationDialog from "./TranslationDialog";
import { useEditor } from "../../../contexts/EditorContext";

const btnCls =
  "px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 whitespace-nowrap " +
  "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 " +
  "hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * 針對「另外兩個語言」各顯示一個按鈕：
 * 同 slug 的該語言草稿已存在 → 「前往 XX 版本」；不存在 → 「翻譯成 XX」。
 *
 * @remarks
 * 兄弟語言只比對本工具資料庫中的草稿（{@link fetchDrafts}），
 * 只存在於 GitHub 而非本工具草稿的文章不會被視為已存在。
 */
export default function TranslationButtons() {
  const { fields, draftId } = useEditor();
  const [, navigate] = useLocation();
  const [enabled, setEnabled] = useState(false);
  const [siblings, setSiblings] = useState<Record<string, string>>({});
  const [dialogLang, setDialogLang] = useState<string | null>(null);

  useEffect(() => {
    fetchTranslationStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  // slug 改變時重新比對同 slug 的其他語言草稿。
  useEffect(() => {
    const slug = fields.slug.trim();
    if (!slug) {
      setSiblings({});
      return;
    }
    let cancelled = false;
    fetchDrafts()
      .then((drafts) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const d of drafts) {
          if (d.slug === slug && d.lang !== fields.lang && d.id !== draftId) {
            map[d.lang] = d.id;
          }
        }
        setSiblings(map);
      })
      .catch(() => {
        if (!cancelled) setSiblings({});
      });
    return () => {
      cancelled = true;
    };
  }, [fields.slug, fields.lang, draftId]);

  const otherLangs = LANG_OPTIONS.filter((l) => l !== fields.lang);

  function disabledReason(): string | undefined {
    if (!fields.slug.trim()) return "請先填寫 slug";
    if (!fields.title.trim()) return "請先填寫標題";
    if (!enabled) return "AI 翻譯未啟用";
    return undefined;
  }

  return (
    <div className="col-span-2 lg:col-span-12 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">翻譯</span>
      <div className="flex flex-wrap gap-2">
        {otherLangs.map((lang) => {
          const siblingId = siblings[lang];
          const label = langLabel(lang);
          if (siblingId) {
            return (
              <button
                key={lang}
                type="button"
                className={btnCls}
                onClick={() => navigate(`/editor/${siblingId}`)}
              >
                前往 {label} 版本
              </button>
            );
          }
          const reason = disabledReason();
          return (
            <button
              key={lang}
              type="button"
              className={btnCls}
              onClick={() => setDialogLang(lang)}
              disabled={reason !== undefined}
              title={reason}
            >
              翻譯成 {label}
            </button>
          );
        })}
      </div>

      <TranslationDialog
        open={dialogLang !== null}
        onOpenChange={(o) => !o && setDialogLang(null)}
        targetLang={dialogLang ?? ""}
      />
    </div>
  );
}
