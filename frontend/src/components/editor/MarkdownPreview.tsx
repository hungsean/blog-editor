import { forwardRef, useMemo } from "react";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import "highlight.js/styles/github-dark.css";
import { renderWithLineMarkers } from "./markdownLineMap";

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  })
);

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

/**
 * Markdown 預覽面板。根 `div` 即為滾動容器，透過 `forwardRef` 對外暴露，
 * 供 `useScrollSync` 讀取滾動位置與 `data-source-line` 標記做行對應同步。
 *
 * @remarks
 * 渲染後的 HTML 一律經 `DOMPurify.sanitize` 消毒才放進 `dangerouslySetInnerHTML`。
 * 草稿內容可能來自 GitHub sync 的外部 repo，未消毒的 `<script>` 或
 * `<img onerror=...>` 等 payload 會造成 XSS。`data-*` 屬性是 DOMPurify 的預設
 * allowlist，因此 `data-source-line` 不會被移除，scroll sync 仍可運作。
 */
const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(
  function MarkdownPreview({ content, className }, ref) {
    const html = useMemo(
      () => DOMPurify.sanitize(renderWithLineMarkers(content)),
      [content],
    );

    return (
      <div
        ref={ref}
        className={`prose prose-invert max-w-none overflow-auto p-6 ${className ?? ""}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
);

export default MarkdownPreview;
