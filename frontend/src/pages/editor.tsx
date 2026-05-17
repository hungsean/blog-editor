import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { fetchDraft, createDraft, updateDraft, publishDraft, type Draft } from "../lib/api/drafts";
import FieldsPanel, { type FieldValues } from "../components/editor/FieldsPanel";
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

export default function EditorPage({ id }: EditorPageProps) {
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const save = useCallback(
    async (latestFields: FieldValues, latestContent: string) => {
      const currentId = draftIdRef.current;
      if (!currentId) return;
      setSaveStatus("saving");
      try {
        await updateDraft(currentId, fieldsToDraftBody(latestFields, latestContent));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    []
  );

  function scheduleSave(nextFields: FieldValues, nextContent: string) {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(nextFields, nextContent), 1200);
  }

  function handleFieldsChange(next: FieldValues) {
    setFields(next);
    scheduleSave(next, content);
  }

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
      <FieldsPanel fields={fields} onChange={handleFieldsChange} content={content} draftId={draftId} />

      {/* Editor + Preview */}
      <div className="flex flex-1 overflow-hidden">
        <MarkdownEditor
          value={content}
          onChange={handleContentChange}
          onViewChange={setEditorView}
          className="flex-1 overflow-hidden border-r border-gray-200 dark:border-gray-800 [&_.cm-editor]:h-full"
        />
        <MarkdownPreview
          ref={setPreviewEl}
          content={content}
          className="flex-1 overflow-auto bg-white dark:bg-gray-950"
        />
      </div>
    </div>
  );
}
