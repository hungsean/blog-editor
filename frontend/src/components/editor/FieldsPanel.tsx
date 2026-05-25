import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import DatePicker from "./DatePicker";
import OgImageDialog from "./OgImageDialog";
import TranslationButtons from "./TranslationButtons";
import { useSlugCheck } from "./useSlugCheck";
import { useEditor } from "../../contexts/EditorContext";
import { LANG_OPTIONS } from "../../lib/langs";

export interface FieldValues {
  title: string;
  slug: string;
  lang: string;
  description: string;
  tags: string[];
pubDate: string;
  nsfw: boolean;
  ogImage: string;
}

const inputCls =
  "w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 " +
  "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 " +
  "placeholder:text-gray-400 dark:placeholder:text-gray-500 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-400/40 transition-colors";

const fieldBtnCls =
  "px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 whitespace-nowrap " +
  "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 " +
  "hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export default function FieldsPanel() {
  const { fields, updateFields, draftId } = useEditor();
  const [collapsed, setCollapsed] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [ogDialog, setOgDialog] = useState<null | "pick" | "generate">(null);
  const slugCheck = useSlugCheck(fields.slug, fields.lang, draftId);

  function set<K extends keyof FieldValues>(key: K, value: FieldValues[K]) {
    updateFields({ ...fields, [key]: value });
  }

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !fields.tags.includes(tag)) {
      set("tags", [...fields.tags, tag]);
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    set("tags", fields.tags.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && fields.tags.length > 0) {
      removeTag(fields.tags.at(-1)!);
    }
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <button
        className="w-full flex items-center gap-2 px-6 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <ChevronDown
          size={16}
          className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
        />
        文章設定
      </button>

      {!collapsed && (
        // mobile 維持兩欄；lg（>= 1024px）改用 12 格網格讓短欄位並排、長欄位跨欄，
        // 避免 desktop 上欄位被拉到滿螢幕寬。md–lg 平板區間沿用兩欄以免欄位過窄。
        <div className="px-6 pb-5 pt-1 grid grid-cols-2 lg:grid-cols-12 gap-x-6 gap-y-4">
          {/* Title */}
          <div className="col-span-2 lg:col-span-6 flex flex-col gap-1">
            <label htmlFor="field-title" className="text-xs font-medium text-gray-500 dark:text-gray-400">Title</label>
            <input
              id="field-title"
              className={inputCls}
              type="text"
              value={fields.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="文章標題"
            />
          </div>

          {/* Slug */}
          <div className="lg:col-span-3 flex flex-col gap-1">
            <label htmlFor="field-slug" className="text-xs font-medium text-gray-500 dark:text-gray-400">Slug</label>
            <input
              id="field-slug"
              className={`${inputCls}${slugCheck.status === "conflict" ? " !border-red-400 dark:!border-red-500" : ""}`}
              type="text"
              value={fields.slug}
              onChange={(e) => set("slug", e.target.value)}
              placeholder="url-slug"
              aria-invalid={slugCheck.status === "conflict"}
            />
            {slugCheck.status === "checking" && (
              <span className="text-xs text-gray-400">檢查 slug 是否重複...</span>
            )}
            {slugCheck.status === "conflict" && (
              <span className="text-xs text-red-500 dark:text-red-400">
                已有 {fields.lang} 草稿使用此 slug：
                {slugCheck.matches.map((m) => m.title.trim() || "(未命名)").join("、")}
              </span>
            )}
            {slugCheck.status === "error" && (
              <span className="text-xs text-yellow-500 dark:text-yellow-400">slug 檢查失敗，請稍後再試</span>
            )}
          </div>

          {/* Lang */}
          <div className="lg:col-span-3 flex flex-col gap-1">
            <label htmlFor="field-lang" className="text-xs font-medium text-gray-500 dark:text-gray-400">Language</label>
            <select
              id="field-lang"
              className={inputCls}
              value={fields.lang}
              onChange={(e) => set("lang", e.target.value)}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="col-span-2 lg:col-span-6 flex flex-col gap-1">
            <label htmlFor="field-description" className="text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
            <textarea
              id="field-description"
              className={`${inputCls} resize-none`}
              rows={1}
              value={fields.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="文章摘要"
            />
          </div>

          {/* Tags */}
          <div className="col-span-2 lg:col-span-6 flex flex-col gap-1">
            <label htmlFor="field-tags" className="text-xs font-medium text-gray-500 dark:text-gray-400">Tags</label>
            <div className={`${inputCls} flex flex-wrap gap-1.5 min-h-9 h-auto py-1.5`}>
              {fields.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-blue-900 dark:hover:text-blue-100"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="field-tags"
                type="text"
                inputMode="text"
                enterKeyHint="done"
                className="flex-1 min-w-24 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => tagInput.trim() && addTag(tagInput)}
                placeholder={fields.tags.length === 0 ? "輸入 tag，Enter 或逗號新增" : ""}
              />
            </div>
          </div>

          {/* pubDate */}
          <div className="lg:col-span-3 flex flex-col gap-1">
            <label htmlFor="field-pubdate" className="text-xs font-medium text-gray-500 dark:text-gray-400">Publish Date</label>
            <DatePicker id="field-pubdate" value={fields.pubDate} onChange={(v) => set("pubDate", v)} />
          </div>

          {/* nsfw */}
          <div className="lg:col-span-3 flex flex-col gap-1 justify-center">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">NSFW</span>
            <label htmlFor="field-nsfw" className="flex items-center gap-2 cursor-pointer">
              <input
                id="field-nsfw"
                type="checkbox"
                checked={fields.nsfw}
                onChange={(e) => set("nsfw", e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 accent-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">標記為 NSFW</span>
            </label>
          </div>

          {/* ogImage */}
          <div className="col-span-2 lg:col-span-6 flex flex-col gap-1">
            <label htmlFor="field-ogimage" className="text-xs font-medium text-gray-500 dark:text-gray-400">OG Image URL</label>
            <div className="flex gap-2">
              <input
                id="field-ogimage"
                className={`${inputCls} flex-1 min-w-0`}
                type="url"
                value={fields.ogImage}
                onChange={(e) => set("ogImage", e.target.value)}
                placeholder="https://example.com/cover.jpg"
              />
              <button
                type="button"
                className={fieldBtnCls}
                onClick={() => setOgDialog("pick")}
              >
                選擇圖片
              </button>
              <button
                type="button"
                className={fieldBtnCls}
                onClick={() => setOgDialog("generate")}
                disabled={!draftId || !fields.title.trim()}
                title={fields.title.trim() ? undefined : "請先填寫標題"}
              >
                生成 OG 圖
              </button>
            </div>
          </div>

          {/* 翻譯 */}
          <TranslationButtons />
        </div>
      )}

      <OgImageDialog
        open={ogDialog !== null}
        onOpenChange={(o) => !o && setOgDialog(null)}
        mode={ogDialog ?? "pick"}
      />
    </div>
  );
}
