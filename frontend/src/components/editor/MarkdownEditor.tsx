import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, indentOnInput, bracketMatching, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { oneDarkTheme } from "@codemirror/theme-one-dark";
import ImagePickerDialog from "./ImagePickerDialog";

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c678dd" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: "#e06c75" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#61afef" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#d19a66" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#abb2bf" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#e5c07b" },
  { tag: [tags.operator, tags.operatorKeyword, tags.escape, tags.regexp, tags.special(tags.string)], color: "#56b6c2" },
  { tag: tags.meta, color: "#7d8799" },
  { tag: tags.comment, color: "#7d8799", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  // headings: bright white gradient h1→h6
  { tag: tags.heading, fontWeight: "bold", color: "#ffffff" },
  { tag: tags.heading1, color: "#ffffff", fontWeight: "bold" },
  { tag: tags.heading2, color: "#e8e8e8", fontWeight: "bold" },
  { tag: tags.heading3, color: "#d8d8d8", fontWeight: "bold" },
  { tag: tags.heading4, color: "#c8c8c8", fontWeight: "bold" },
  { tag: tags.heading5, color: "#b8b8b8", fontWeight: "bold" },
  { tag: tags.heading6, color: "#a8a8a8", fontWeight: "bold" },
  // links: bright blue
  { tag: tags.link, color: "#7eb8ff", textDecoration: "underline" },
  { tag: tags.url, color: "#7eb8ff" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#d19a66" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "#98c379" },
  { tag: tags.invalid, color: "#ffffff" },
]);

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function MarkdownEditor({ value, onChange, className }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...closeBracketsKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          markdown({ base: markdownLanguage }),
          oneDarkTheme,
          syntaxHighlighting(highlightStyle),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes without resetting cursor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  /**
   * 在目前游標／選取範圍插入 markdown 圖片語法。
   *
   * @remarks
   * 插入後游標停在 `![` 與 `]` 之間（alt 文字處），方便接著輸入描述。
   * 有選取範圍時，選取的文字會被圖片語法取代。
   */
  function insertImage(url: string) {
    const view = viewRef.current;
    if (!view) return;
    const snippet = `![](${url})`;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + 2 },
    });
    view.focus();
  }

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 px-3 py-2 shrink-0">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
        >
          上傳圖片
        </button>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
      <ImagePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onSelect={insertImage} />
    </div>
  );
}
