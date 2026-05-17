import { forwardRef, useMemo } from "react";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
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
 */
const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(
  function MarkdownPreview({ content, className }, ref) {
    const html = useMemo(() => renderWithLineMarkers(content), [content]);

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
