import React, { useState } from "react";

interface TagsInputProps {
  readonly id?: string;
  readonly tags: string[];
  readonly onChange: (tags: string[]) => void;
  readonly className?: string;
}

/**
 * 以 chip 形式呈現的標籤輸入框，Enter 或逗號新增 tag、× 或退格刪除。
 *
 * @remarks
 * 輸入中的文字由元件自己以 local state 管理，只有「確定新增/刪除」時才透過
 * `onChange` 回報完整的 tags 陣列，避免每打一個字都觸發外層 re-render 與存檔。
 *
 * 地雷：
 * - 重複的 tag 會被靜默忽略（不報錯），避免 chip 重複。
 * - 失焦（onBlur）時會把殘留的輸入也補成 tag，否則使用者打完沒按 Enter 會遺失。
 * - Backspace 只有在輸入框為空時才刪除最後一個 tag，避免誤刪正在編輯的文字。
 */
export default function TagsInput({ id, tags, onChange, className }: TagsInputProps) {
  const [input, setInput] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      removeTag(tags.at(-1)!);
    }
  }

  return (
    <div
      className={
        "w-full px-3 text-sm rounded-md border border-gray-200 dark:border-gray-700 " +
        "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 " +
        "focus-within:ring-2 focus-within:ring-blue-500/50 dark:focus-within:ring-blue-400/40 transition-colors " +
        "flex flex-wrap gap-1.5 min-h-9 h-auto py-1.5 " +
        (className ?? "")
      }
    >
      {tags.map((tag) => (
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
        id={id}
        type="text"
        inputMode="text"
        enterKeyHint="done"
        className="flex-1 min-w-24 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => input.trim() && addTag(input)}
        placeholder={tags.length === 0 ? "輸入 tag，Enter 或逗號新增" : ""}
      />
    </div>
  );
}
