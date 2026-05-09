import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

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

interface FieldsPanelProps {
  fields: FieldValues;
  onChange: (fields: FieldValues) => void;
}

const LANG_OPTIONS = ["zh-tw", "en", "ja"];

const inputCls =
  "w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 " +
  "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 " +
  "placeholder:text-gray-400 dark:placeholder:text-gray-500 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-400/40 transition-colors";

export default function FieldsPanel({ fields, onChange }: FieldsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tagInput, setTagInput] = useState("");

  function set<K extends keyof FieldValues>(key: K, value: FieldValues[K]) {
    onChange({ ...fields, [key]: value });
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
      removeTag(fields.tags[fields.tags.length - 1]!);
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
        <div className="px-6 pb-5 pt-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Title */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Title</label>
            <input
              className={inputCls}
              type="text"
              value={fields.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="文章標題"
            />
          </div>

          {/* Slug */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Slug</label>
            <input
              className={inputCls}
              type="text"
              value={fields.slug}
              onChange={(e) => set("slug", e.target.value)}
              placeholder="url-slug"
            />
          </div>

          {/* Lang */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Language</label>
            <select
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
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              value={fields.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="文章摘要"
            />
          </div>

          {/* Tags */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Tags</label>
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
                type="text"
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
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Publish Date</label>
            <input
              className={inputCls}
              type="date"
              value={fields.pubDate}
              onChange={(e) => set("pubDate", e.target.value)}
            />
          </div>

          {/* nsfw */}
          <div className="flex flex-col gap-1 justify-center">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">NSFW</label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fields.nsfw}
                onChange={(e) => set("nsfw", e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 accent-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">標記為 NSFW</span>
            </label>
          </div>

          {/* ogImage */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">OG Image URL</label>
            <input
              className={inputCls}
              type="url"
              value={fields.ogImage}
              onChange={(e) => set("ogImage", e.target.value)}
              placeholder="https://example.com/cover.jpg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
