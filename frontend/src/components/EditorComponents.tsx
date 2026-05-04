import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import flatpickr from "flatpickr";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import { api, type Draft, type TranslationLink } from "../api";
import { slugifyClient } from "../utils/text";

marked.use(markedHighlight({
  langPrefix: "hljs language-",
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    return hljs.highlight(code, { language }).value;
  },
}));

export type DraftForm = {
  title: string;
  lang: string;
  slug: string;
  description: string;
  tags: string[];
  fields: Record<string, unknown>;
};

type SlugState = {
  state: "idle" | "checking" | "valid" | "invalid";
  reason: string | null;
  conflict: { title: string } | null;
};

const LANGS = [
  { value: "zh-tw", label: "繁中 (zh-tw)" },
  { value: "en", label: "English (en)" },
  { value: "ja", label: "日本語 (ja)" },
];

export function draftToForm(draft: Draft): DraftForm {
  return {
    title: draft.title,
    lang: draft.lang || "zh-tw",
    slug: draft.slug || slugifyClient(draft.title || ""),
    description: draft.description || "",
    tags: JSON.parse(draft.tags || "[]"),
    fields: JSON.parse(draft.fields || "{}"),
  };
}

export function formToDraftPatch(form: DraftForm, content: string): Partial<Draft> {
  return {
    title: form.title,
    lang: form.lang,
    slug: form.slug.trim(),
    description: form.description,
    tags: JSON.stringify(form.tags),
    fields: JSON.stringify(form.fields),
    content,
  };
}

type FieldsPanelProps = {
  form: DraftForm;
  slugState: SlugState;
  onChange: (next: DraftForm) => void;
  onSlugReset: () => void;
  onUploadImage: (file: File) => Promise<string>;
  onUploadOgHero: (file: File) => Promise<string>;
  onGenerateOg: (heroToken: string | null) => Promise<string>;
};

export function FieldsPanel({ form, slugState, onChange, onSlugReset, onUploadImage, onUploadOgHero, onGenerateOg }: FieldsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [heroToken, setHeroToken] = useState<string | null>(null);
  const [heroName, setHeroName] = useState("未選取");
  const [ogBusy, setOgBusy] = useState(false);

  function update<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function updateField(key: string, value: unknown) {
    onChange({ ...form, fields: { ...form.fields, [key]: value } });
  }

  function commitTag() {
    const value = tagInput.trim();
    if (!value) return;
    update("tags", [...form.tags, value]);
    setTagInput("");
  }

  async function uploadOgUrl(file: File) {
    const url = await onUploadImage(file);
    updateField("ogImage", url);
  }

  async function pickHero(file: File) {
    setHeroName("上傳中...");
    try {
      setHeroToken(await onUploadOgHero(file));
      setHeroName(file.name);
    } catch (error) {
      setHeroToken(null);
      setHeroName("上傳失敗");
      alert(`封面圖上傳失敗：${(error as Error).message}`);
    }
  }

  async function generateOg() {
    if (!confirm("確定要生成 OG 圖片？現有的 OG 圖片 URL 將被覆蓋。")) return;
    setOgBusy(true);
    try {
      updateField("ogImage", await onGenerateOg(heroToken));
      setHeroToken(null);
      setHeroName("未選取");
    } catch (error) {
      alert(`生成失敗：${(error as Error).message}`);
    } finally {
      setOgBusy(false);
    }
  }

  const slugMessage = slugState.state === "checking"
    ? "檢查 slug..."
    : slugState.state === "valid"
      ? "此 slug 可使用"
      : slugState.state === "invalid" && slugState.reason === "required"
        ? "Slug 為必填"
        : slugState.state === "invalid" && slugState.reason === "conflict" && slugState.conflict
          ? `此語言已有相同 slug：${slugState.conflict.title}`
          : slugState.state === "invalid"
            ? "無法檢查 slug"
            : "";

  return (
    <div className="fields-panel" data-collapsed={collapsed ? "true" : "false"}>
      <button className="fields-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
        <span className="fields-toggle-label">文章設定</span>
        <span className="fields-toggle-icon">⌄</span>
      </button>
      <div className="fields-form-body">
        <div className="field-group">
          <label>標題 *</label>
          <input value={form.title} onChange={(event) => update("title", event.currentTarget.value)} />
        </div>
        <div className="field-group">
          <label>Slug <small>（URL 識別碼，翻譯版本共用）</small></label>
          <div className="inline-field-row">
            <input
              id="slug-input"
              className={slugState.state === "valid" ? "slug-valid" : slugState.state === "invalid" ? "slug-invalid" : ""}
              value={form.slug}
              onChange={(event) => update("slug", event.currentTarget.value)}
              placeholder="自動從標題產生"
            />
            <button type="button" className="btn btn-secondary compact-btn" onClick={onSlugReset}>重設</button>
          </div>
          <span className={`slug-check-msg ${slugState.state === "valid" ? "slug-check-msg--valid" : slugState.state === "invalid" ? "slug-check-msg--invalid" : ""}`}>{slugMessage}</span>
        </div>
        <div className="field-group">
          <label>語言</label>
          <select value={form.lang} onChange={(event) => update("lang", event.currentTarget.value)}>
            {LANGS.map((lang) => <option key={lang.value} value={lang.value}>{lang.value}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label>描述</label>
          <input value={form.description} onChange={(event) => update("description", event.currentTarget.value)} />
        </div>
        <div className="field-group">
          <label>標籤 <small>(Enter 新增)</small></label>
          <div className="tags-input-wrap" onClick={() => document.getElementById("tags-input")?.focus()}>
            {form.tags.map((tag) => (
              <span className="tag-chip" key={tag}>
                {tag}<button className="tag-chip-remove" onClick={() => update("tags", form.tags.filter((item) => item !== tag))}>×</button>
              </span>
            ))}
            <input
              id="tags-input"
              className="tags-input"
              value={tagInput}
              placeholder="輸入標籤..."
              onChange={(event) => setTagInput(event.currentTarget.value)}
              onBlur={commitTag}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === ",") && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commitTag();
                } else if (event.key === "Backspace" && !tagInput) {
                  update("tags", form.tags.slice(0, -1));
                }
              }}
            />
          </div>
        </div>
        <DateField value={String(form.fields.pubDate ?? new Date().toISOString().slice(0, 10))} onChange={(value) => updateField("pubDate", value)} />
        <div className="field-group">
          <label>nsfw</label>
          <div className="toggle-wrap">
            <input type="checkbox" checked={Boolean(form.fields.nsfw)} onChange={(event) => updateField("nsfw", event.currentTarget.checked)} />
            <span>nsfw</span>
          </div>
        </div>
        <div className="field-group">
          <label>OG 圖片 URL</label>
          <div className="inline-field-row">
            <input
              type="url"
              value={String(form.fields.ogImage ?? "")}
              placeholder="https://i.example.com/cover.jpg"
              onChange={(event) => updateField("ogImage", event.currentTarget.value)}
            />
            <button type="button" className="btn btn-secondary compact-btn" onClick={() => previewOg(String(form.fields.ogImage ?? ""))}>👁</button>
            <FileButton label="↑ 上傳" className="btn btn-secondary compact-btn" onPick={uploadOgUrl} />
            <button type="button" className="btn btn-primary compact-btn" disabled={ogBusy} onClick={generateOg}>{ogBusy ? "生成中..." : "✦ 生成 OG"}</button>
          </div>
          <div className="og-hero-row">
            <FileButton label="封面圖（選填）" className="btn btn-secondary compact-btn" onPick={pickHero} />
            <span className="og-hero-filename">{heroName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    const picker = flatpickr(inputRef.current, {
      dateFormat: "Y-m-d",
      allowInput: false,
      disableMobile: true,
      onChange: (_dates, dateStr) => onChange(dateStr),
    });
    return () => {
      if (Array.isArray(picker)) picker.forEach((item) => item.destroy());
      else picker.destroy();
    };
  }, [onChange]);

  return (
    <div className="field-group">
      <label>pubDate *</label>
      <input ref={inputRef} type="text" value={value.slice(0, 10)} readOnly onChange={(event) => onChange(event.currentTarget.value)} />
    </div>
  );
}

function FileButton({ label, className, onPick }: { label: string; className: string; onPick: (file: File) => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => inputRef.current?.click()}>{label}</button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void onPick(file);
        }}
      />
    </>
  );
}

function previewOg(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    alert("尚未設定 OG 圖片 URL");
    return;
  }
  const noCache = trimmed + (trimmed.includes("?") ? "&" : "?") + "_t=" + Date.now();
  const win = window.open("", "_blank", "width=1200,height=700,toolbar=0,menubar=0,scrollbars=1");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>OG 圖片預覽</title></head><body style="margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#ccc"><img src="${noCache}" alt="OG Image" style="max-width:100%;border:1px solid #333;display:block"><p style="margin:12px 0 4px;font-size:0.8rem;opacity:0.6;word-break:break-all;max-width:1200px;text-align:center">${trimmed}</p></body></html>`);
  win.document.close();
}

type TranslationSectionProps = {
  currentLang: string;
  translations: TranslationLink[];
  aiEnabled: boolean;
  onCreate: (targetLang: string, ai: boolean) => Promise<void>;
};

export function TranslationSection({ currentLang, translations, aiEnabled, onCreate }: TranslationSectionProps) {
  const existing = useMemo(() => new Map(translations.map((item) => [item.lang, item])), [translations]);
  const others = LANGS.filter((lang) => lang.value !== currentLang);

  return (
    <div className="translation-section">
      <label>翻譯版本</label>
      <div className="translation-actions">
        {others.map((lang) => {
          const link = existing.get(lang.value);
          if (link) {
            return (
              <a key={lang.value} href={`/editor/${link.id}`} className="btn btn-filled translation-link">
                <span className={link.status === "pr_opened" ? "status-dot status-dot-open" : "status-dot"}>●</span>{lang.label} →
              </a>
            );
          }
          return aiEnabled ? (
            <span key={lang.value} className="translation-button-pair">
              <button className="btn btn-primary compact-btn" onClick={() => onCreate(lang.value, true)}>✨ AI 翻譯 {lang.label}</button>
              <button className="btn btn-secondary compact-btn" onClick={() => onCreate(lang.value, false)}>複製</button>
            </span>
          ) : (
            <button key={lang.value} className="btn btn-secondary compact-btn" onClick={() => onCreate(lang.value, false)}>+ {lang.label}</button>
          );
        })}
      </div>
    </div>
  );
}

type EditorSplitViewProps = {
  content: string;
  onChange: (content: string) => void;
  onUploadImage: (file: File) => Promise<string>;
};

export function EditorSplitView({ content, onChange, onUploadImage }: EditorSplitViewProps) {
  const viewRef = useRef<EditorView | null>(null);
  const [uploading, setUploading] = useState(false);

  async function insertImage(file: File) {
    const view = viewRef.current;
    if (!view) return;
    const uid = Date.now().toString(36);
    const placeholder = `##uploading-${uid}##`;
    const insertText = `![上傳中...](${placeholder})`;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, to: from, insert: insertText }, selection: { anchor: from + insertText.length } });
    view.focus();
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      const next = view.state.doc.toString();
      const idx = next.indexOf(placeholder);
      if (idx !== -1) {
        const blockStart = next.lastIndexOf("![", idx);
        const blockEnd = next.indexOf(")", idx) + 1;
        view.dispatch({
          changes: blockStart !== -1 && blockEnd > blockStart
            ? { from: blockStart, to: blockEnd, insert: `![](${url})` }
            : { from: idx, to: idx + placeholder.length, insert: url },
        });
      }
    } catch (error) {
      alert(`上傳失敗：${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="editor-toolbar">
        <FileButton label={uploading ? "上傳中..." : "↑ 插入圖片"} className="btn btn-secondary compact-btn" onPick={insertImage} />
      </div>
      <div className="editor-wrap">
        <CodeMirrorEditor content={content} onChange={onChange} onReady={(view) => { viewRef.current = view; }} />
        <MarkdownPreview content={content} editorView={viewRef} />
      </div>
    </>
  );
}

function CodeMirrorEditor({ content, onChange, onReady }: { content: string; onChange: (content: string) => void; onReady: (view: EditorView) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown({ base: markdownLanguage, codeLanguages: [] }),
          oneDark,
          EditorView.lineWrapping,
          Prec.high(keymap.of([{ key: "Enter", run: continueListOnEnter }])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    onReady(view);
    return () => view.destroy();
  }, []);

  return <div id="md-editor" ref={hostRef} />;
}

function MarkdownPreview({ content, editorView }: { content: string; editorView: MutableRefObject<EditorView | null> }) {
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const view = editorView.current;
    const previewEl = previewRef.current;
    if (!view || !previewEl) return;
    let source: "editor" | "preview" | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { source = null; }, 100);
    };
    const anchors = () => [...previewEl.querySelectorAll<HTMLElement>("[data-source-line]")]
      .map((el) => ({ el, line: Number(el.dataset.sourceLine) }))
      .filter((item) => !Number.isNaN(item.line));
    const fromEditor = () => {
      if (source === "preview") return;
      source = "editor";
      const scrollTop = view.scrollDOM.scrollTop;
      const scrollMax = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
      if (scrollMax <= 0) return;
      const topBlock = view.lineBlockAtHeight(scrollTop);
      const topLine = view.state.doc.lineAt(topBlock.from).number;
      const points = anchors();
      const before = points.filter((item) => item.line <= topLine).at(-1);
      const after = points.find((item) => item.line > topLine);
      if (!before) previewEl.scrollTop = 0;
      else if (!after) previewEl.scrollTop = (scrollTop / scrollMax) * (previewEl.scrollHeight - previewEl.clientHeight);
      else {
        const totalLines = view.state.doc.lines;
        const eBefore = view.lineBlockAt(view.state.doc.line(before.line).from).top;
        const eAfter = view.lineBlockAt(view.state.doc.line(Math.min(after.line, totalLines)).from).top;
        const frac = eAfter > eBefore ? Math.max(0, Math.min(1, (scrollTop - eBefore) / (eAfter - eBefore))) : 0;
        previewEl.scrollTop = before.el.offsetTop + frac * (after.el.offsetTop - before.el.offsetTop);
      }
      reset();
    };
    const fromPreview = () => {
      if (source === "editor") return;
      source = "preview";
      const scrollTop = previewEl.scrollTop;
      const scrollMax = previewEl.scrollHeight - previewEl.clientHeight;
      if (scrollMax <= 0) return;
      const points = anchors();
      const before = points.filter((item) => item.el.offsetTop <= scrollTop).at(-1);
      const after = points.find((item) => item.el.offsetTop > scrollTop);
      if (!before) view.scrollDOM.scrollTop = 0;
      else if (!after) view.scrollDOM.scrollTop = (scrollTop / scrollMax) * (view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      else {
        const totalLines = view.state.doc.lines;
        const frac = after.el.offsetTop > before.el.offsetTop
          ? Math.max(0, Math.min(1, (scrollTop - before.el.offsetTop) / (after.el.offsetTop - before.el.offsetTop)))
          : 0;
        const eBefore = view.lineBlockAt(view.state.doc.line(before.line).from).top;
        const eAfter = view.lineBlockAt(view.state.doc.line(Math.min(after.line, totalLines)).from).top;
        view.scrollDOM.scrollTop = eBefore + frac * (eAfter - eBefore);
      }
      reset();
    };
    view.scrollDOM.addEventListener("scroll", fromEditor, { passive: true });
    previewEl.addEventListener("scroll", fromPreview, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", fromEditor);
      previewEl.removeEventListener("scroll", fromPreview);
      if (timer) clearTimeout(timer);
    };
  }, [editorView]);

  const html = useMemo(() => {
    const tokens = marked.lexer(content || "");
    const blockLineNumbers: number[] = [];
    const blockTypes = new Set(["heading", "paragraph", "code", "blockquote", "list", "hr", "table", "html"]);
    let line = 1;
    for (const token of tokens) {
      if (blockTypes.has(token.type)) blockLineNumbers.push(line);
      line += (token.raw.match(/\n/g) || []).length;
    }
    const root = document.createElement("div");
    root.innerHTML = marked.parse(content || "") as string;
    const blockEls = root.querySelectorAll<HTMLElement>(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > pre, :scope > blockquote, :scope > ul, :scope > ol, :scope > hr, :scope > table, :scope > div");
    blockEls.forEach((el, index) => {
      if (index < blockLineNumbers.length) el.dataset.sourceLine = String(blockLineNumbers[index]);
    });
    return root.innerHTML;
  }, [content]);

  return <div id="md-preview" ref={previewRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function continueListOnEnter(view: EditorView) {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const match = line.text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)\.\s+|>\s+)(.*)$/);
  if (!match) return false;
  const indent = match[1] ?? "";
  const marker = match[2] ?? "";
  const num = match[3];
  const rest = match[4] ?? "";
  if (rest.length === 0) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: indent }, selection: { anchor: line.from + indent.length } });
    return true;
  }
  let nextMarker = marker;
  if (num !== undefined) nextMarker = `${Number(num) + 1}. `;
  else if (/\[[ xX]\]/.test(marker)) nextMarker = marker.replace(/\[[xX]\]/, "[ ]");
  const insert = `\n${indent}${nextMarker}`;
  view.dispatch({ changes: { from, to: from, insert }, selection: { anchor: from + insert.length } });
  return true;
}
