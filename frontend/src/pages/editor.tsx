import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { fetchDraft, createDraft, updateDraft, publishDraft, type Draft } from "../lib/api/drafts";
import FieldsPanel, { type FieldValues } from "../components/editor/fields/FieldsPanel";
import { EditorProvider } from "../contexts/EditorContext";
import MarkdownEditor from "../components/editor/MarkdownEditor";
import MarkdownPreview from "../components/editor/MarkdownPreview";
import { useScrollSync } from "../components/editor/useScrollSync";
import type { EditorView } from "@codemirror/view";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../components/ui/dialog";

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

/** 編輯器版面模式：雙欄、僅編輯、僅預覽。 */
type EditorMode = "both" | "editor" | "preview";

const MODE_OPTIONS: { value: EditorMode; label: string }[] = [
  { value: "editor", label: "編輯" },
  { value: "both", label: "雙欄" },
  { value: "preview", label: "預覽" },
];

/**
 * 取得初始版面模式：桌機（>= 768px）預設雙欄，行動裝置預設僅編輯。
 *
 * @remarks
 * 只在元件初次掛載時讀一次，之後由使用者手動切換；不隨視窗縮放自動改變，
 * 避免覆蓋使用者的選擇。768px 對應 Tailwind 的 `md` 斷點。
 */
function getDefaultMode(): EditorMode {
  if (globalThis.window !== undefined && globalThis.matchMedia("(max-width: 767px)").matches) {
    return "editor";
  }
  return "both";
}

interface EditorPageProps {
  id?: string;
}

function draftToFields(draft: Draft): FieldValues {
  const extra = JSON.parse(draft.fields || "{}");
  const tags = JSON.parse(draft.tags || "[]");
  return {
    title: draft.title ?? "",
    slug: draft.slug ?? "",
    lang: draft.lang ?? "zh-tw",
    description: draft.description ?? "",
    tags: Array.isArray(tags) ? tags : [],
    pubDate: extra.pubDate ?? "",
    nsfw: extra.nsfw ?? false,
    ogImage: extra.ogImage ?? "",
  };
}

function fieldsToDraftBody(fields: FieldValues, content: string): Partial<Draft> {
  const { title, slug, lang, description, tags, pubDate, nsfw, ogImage } = fields;
  const extra: Record<string, unknown> = {};
  if (pubDate) extra.pubDate = pubDate;
  if (nsfw) extra.nsfw = nsfw;
  if (ogImage) extra.ogImage = ogImage;

  return {
    title,
    slug,
    lang,
    description,
    tags: JSON.stringify(tags),
    fields: JSON.stringify(extra),
    content,
  };
}

export default function EditorPage({ id }: Readonly<EditorPageProps>) {
  const [, navigate] = useLocation();
  const [draftId, setDraftId] = useState<string | null>(id ?? null);
  const [fields, setFields] = useState<FieldValues>({
    title: "",
    slug: "",
    lang: "zh-tw",
    description: "",
    tags: [],
    pubDate: new Date().toISOString().slice(0, 10),
    nsfw: false,
    ogImage: "",
  });
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loading, setLoading] = useState(!!id);
  const [publishing, setPublishing] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<EditorMode>(getDefaultMode);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 尚未送出的 debounce 儲存內容；save 執行後清空，供 unmount 時 flush。 */
  const pendingSaveRef = useRef<{ fields: FieldValues; content: string } | null>(null);
  const draftIdRef = useRef<string | null>(id ?? null);

  useScrollSync(editorView, previewEl);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  useEffect(() => {
    if (!id) {
      createDraft().then((draft) => {
        setDraftId(draft.id);
        draftIdRef.current = draft.id;
        navigate(`/editor/${draft.id}`, { replace: true });
      });
      return;
    }

    fetchDraft(id)
      .then((draft) => {
        setFields(draftToFields(draft));
        setContent(draft.content ?? "");
        setSaveStatus("saved");
      })
      .catch(() => setSaveStatus("error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 純 API 儲存：只送出 PATCH，不碰任何 UI state。
   *
   * @remarks
   * 與 `save` 分離，是為了讓 unmount cleanup 能安全 flush —— cleanup 在元件卸載後
   * 才呼叫，若此處有 `setState` 會觸發 React 的 unmounted setState 警告。
   */
  const saveToApi = useCallback(
    async (latestFields: FieldValues, latestContent: string) => {
      const currentId = draftIdRef.current;
      if (!currentId) return;
      pendingSaveRef.current = null;
      await updateDraft(currentId, fieldsToDraftBody(latestFields, latestContent));
    },
    []
  );

  const save = useCallback(
    async (latestFields: FieldValues, latestContent: string) => {
      if (!draftIdRef.current) return;
      setSaveStatus("saving");
      try {
        await saveToApi(latestFields, latestContent);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [saveToApi]
  );

  function scheduleSave(nextFields: FieldValues, nextContent: string) {
    setSaveStatus("unsaved");
    pendingSaveRef.current = { fields: nextFields, content: nextContent };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(nextFields, nextContent), 1200);
  }

  // 離開編輯器前：取消待送的 debounce 計時器，並 flush 尚未儲存的內容。
  // 用 saveToApi（不 setState）而非 save，避免卸載後更新 UI state 的警告。
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const pending = pendingSaveRef.current;
      if (pending) saveToApi(pending.fields, pending.content).catch(() => { });
    };
  }, [saveToApi]);

  const handleFieldsChange = useCallback((next: FieldValues) => {
    setFields(next);
    scheduleSave(next, content);
    // scheduleSave 是穩定的元件內函式；content 變動時要拿到最新值，故列為依賴。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  async function handleConfirmPublish() {
    if (!draftId || publishing) return;
    setConfirmOpen(false);
    setPrError(null);
    setPublishing(true);
    try {
      await save(fields, content);
      const result = await publishDraft(draftId);
      if (result.success) {
        window.open(result.pr_url, "_blank");
      } else {
        setPrError(result.error);
      }
    } catch (err) {
      setPrError(String(err));
    } finally {
      setPublishing(false);
    }
  }

  function handleContentChange(next: string) {
    setContent(next);
    scheduleSave(fields, next);
  }

  const SAVE_LABEL: Record<SaveStatus, string> = {
    saved: "已儲存",
    saving: "儲存中...",
    unsaved: "未儲存",
    error: "儲存失敗",
  };

  const SAVE_COLOR: Record<SaveStatus, string> = {
    saved: "text-green-500 dark:text-green-400",
    saving: "text-gray-400",
    unsaved: "text-yellow-500 dark:text-yellow-400",
    error: "text-red-500 dark:text-red-400",
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-400">載入中...</p>
      </div>
    );
  }

  return (
    <EditorProvider draftId={draftId} fields={fields} content={content} updateFields={handleFieldsChange}>
      <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
        {/* TopBar */}
        <header className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            ← 返回列表
          </button>
          <div className="flex items-center gap-3">
            <span className={`text-sm ${SAVE_COLOR[saveStatus]}`}>
              {SAVE_LABEL[saveStatus]}
            </span>
            <button
              onClick={() => save(fields, content)}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            >
              儲存
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={publishing || saveStatus === "saving"}
              className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-md transition-colors"
            >
              {publishing ? "送出中..." : "送出 PR"}
            </button>
          </div>
        </header>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>確認送出 PR</DialogTitle>
              <DialogDescription>
                將會儲存目前內容並對 GitHub 開一個 Pull Request，確定要繼續嗎？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose
                render={
                  <button className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors" />
                }
              >
                取消
              </DialogClose>
              <button
                onClick={handleConfirmPublish}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-md transition-colors"
              >
                確認送出
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {prError && (
          <div className="px-6 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
            PR 送出失敗：{prError}
          </div>
        )}

        {/* Fields panel */}
        <FieldsPanel />

        {/* Mode toggle */}
        <div className="flex justify-end px-6 py-2 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-0.5 rounded-md bg-gray-100 dark:bg-gray-800 p-0.5">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${mode === opt.value
                    ? "bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editor + Preview */}
        <div className="flex flex-1 overflow-hidden">
          {mode !== "preview" && (
            <MarkdownEditor
              value={content}
              onChange={handleContentChange}
              onViewChange={setEditorView}
              className={`flex-1 overflow-hidden [&_.cm-editor]:h-full ${mode === "both" ? "border-r border-gray-200 dark:border-gray-800" : ""
                }`}
            />
          )}
          {mode !== "editor" && (
            <MarkdownPreview
              ref={setPreviewEl}
              content={content}
              className="flex-1 overflow-auto bg-white dark:bg-gray-950"
            />
          )}
        </div>
      </div>
    </EditorProvider>
  );
}
