import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Draft, type TranslationLink } from "../api";
import {
  draftToForm,
  EditorSplitView,
  FieldsPanel,
  formToDraftPatch,
  TranslationSection,
  type DraftForm,
} from "../components/EditorComponents";
import { slugifyClient } from "../utils/text";

type SlugCheckState = "idle" | "checking" | "valid" | "invalid";

export function EditorPage({ draftId }: { draftId: string | null }) {
  const [id, setId] = useState(draftId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [mdContent, setMdContent] = useState("");
  const [translations, setTranslations] = useState<TranslationLink[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [slugState, setSlugState] = useState<{
    state: SlugCheckState;
    reason: string | null;
    conflict: { title: string } | null;
  }>({ state: "idle", reason: null, conflict: null });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugRequestId = useRef(0);
  const initialized = useRef(false);
  const formRef = useRef<DraftForm | null>(null);
  const contentRef = useRef("");
  const savingRef = useRef(false);

  useEffect(() => {
    document.body.classList.add("editor-page");
    return () => document.body.classList.remove("editor-page");
  }, []);

  const loadTranslations = useCallback(async (draftIdValue: string) => {
    try {
      setTranslations(await api.translations(draftIdValue));
    } catch {
      setTranslations([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const statusPromise = api.translationStatus().then((data) => setAiEnabled(data.enabled)).catch(() => {});
      let loadedDraft: Draft | null = null;

      if (id) {
        loadedDraft = await api.getDraft(id).catch(() => null);
      }
      if (!loadedDraft) {
        loadedDraft = await api.createDraft();
        setId(loadedDraft.id);
        history.replaceState(null, "", `/editor/${loadedDraft.id}`);
      }
      if (cancelled) return;

      setDraft(loadedDraft);
      setForm(draftToForm(loadedDraft));
      setMdContent(loadedDraft.content ?? "");
      formRef.current = draftToForm(loadedDraft);
      contentRef.current = loadedDraft.content ?? "";
      initialized.current = true;
      await Promise.all([statusPromise, loadTranslations(loadedDraft.id)]);
    }

    init().catch((error) => alert(`載入失敗：${(error as Error).message}`));
    return () => { cancelled = true; };
  }, []);

  const autoSave = useCallback(async () => {
    if (!id || !formRef.current) return;
    if (savingRef.current) {
      saveTimer.current = setTimeout(autoSave, 500);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveStatus("儲存中...");
    try {
      const previousSlug = draft?.slug;
      const nextDraft = await api.updateDraft(id, formToDraftPatch(formRef.current, contentRef.current));
      setDraft(nextDraft);
      setSaveStatus("已儲存");
      if (previousSlug !== nextDraft.slug) {
        await loadTranslations(id);
      }
    } catch {
      setSaveStatus("儲存失敗");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft?.slug, id, loadTranslations]);

  const scheduleSave = useCallback(() => {
    if (!initialized.current) return;
    setSaveStatus("未儲存");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(autoSave, 1000);
  }, [autoSave]);

  const executeSlugCheck = useCallback(async () => {
    if (!id || !formRef.current) return false;
    const requestId = ++slugRequestId.current;
    const { lang, slug } = formRef.current;
    setSlugState({ state: "checking", reason: null, conflict: null });
    try {
      const data = await api.slugCheck(id, lang, slug.trim());
      if (requestId !== slugRequestId.current) return false;
      setSlugState(data.ok
        ? { state: "valid", reason: "available", conflict: null }
        : { state: "invalid", reason: data.reason, conflict: data.conflict ? { title: data.conflict.title } : null });
      return data.ok;
    } catch {
      if (requestId !== slugRequestId.current) return false;
      setSlugState({ state: "invalid", reason: "error", conflict: null });
      return false;
    }
  }, [id]);

  useEffect(() => {
    if (!form || !initialized.current) return;
    formRef.current = form;
    ++slugRequestId.current;
    setSlugState({ state: "idle", reason: null, conflict: null });
    if (slugTimer.current) clearTimeout(slugTimer.current);
    slugTimer.current = setTimeout(executeSlugCheck, 400);
    scheduleSave();
    return () => {
      if (slugTimer.current) clearTimeout(slugTimer.current);
    };
  }, [form, executeSlugCheck, scheduleSave]);

  useEffect(() => {
    if (!initialized.current) return;
    contentRef.current = mdContent;
    scheduleSave();
  }, [mdContent, scheduleSave]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (slugTimer.current) clearTimeout(slugTimer.current);
  }, []);

  function updateForm(next: DraftForm) {
    setForm((prev) => {
      if (!prev) return next;
      if (prev.title !== next.title && next.slug === prev.slug && prev.slug === slugifyClient(prev.title || "")) {
        return { ...next, slug: slugifyClient(next.title) };
      }
      return next;
    });
  }

  async function publish() {
    if (!id || !formRef.current) return;
    if (!formRef.current.title.trim()) {
      alert("請輸入標題");
      return;
    }

    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (slugTimer.current) clearTimeout(slugTimer.current);
    await autoSave();
    if (slugState.state !== "valid") {
      const ok = await executeSlugCheck();
      if (!ok) return;
    }

    const res = await api.publishDraft(id);
    if (res.pr_url) {
      alert("PR 已建立");
      window.open(res.pr_url, "_blank");
      const nextDraft = await api.getDraft(id);
      setDraft(nextDraft);
    } else if (res.error) {
      alert(`送出失敗：${res.error}`);
    }
  }

  async function createTranslation(targetLang: string, ai: boolean) {
    if (!id) return;
    if (!confirm(ai ? `確定要使用 AI 自動翻譯為 ${targetLang}？` : `確定要建立 ${targetLang} 翻譯版本？內容將從目前草稿複製。`)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await autoSave();
    try {
      const nextDraft = await api.createTranslation(id, targetLang, ai);
      window.location.href = `/editor/${nextDraft.id}`;
    } catch (error) {
      alert(`${ai ? "翻譯" : "建立"}失敗：${(error as Error).message}`);
    }
  }

  async function generateOg(heroToken: string | null) {
    if (!id) throw new Error("Missing draft id");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await autoSave();
    const result = await api.generateOg(id, heroToken);
    setDraft(result.draft);
    return result.ogImageUrl;
  }

  if (!form || !draft || !id) {
    return <div className="editor-container"><p className="loading">載入中...</p></div>;
  }

  return (
    <div className="editor-container">
      <header>
        <a href="/" className="back-link">← 返回列表</a>
        <div className="header-actions">
          <span className="save-status">{saving ? "儲存中..." : saveStatus}</span>
          <button id="btn-publish" className="btn btn-success" onClick={publish}>送出 PR</button>
        </div>
      </header>
      <main>
        <FieldsPanel
          form={form}
          slugState={slugState}
          onChange={updateForm}
          onSlugReset={() => setForm({ ...form, slug: slugifyClient(form.title) })}
          onUploadImage={api.uploadImage}
          onUploadOgHero={(file) => api.uploadOgHero(id, file).then((data) => data.heroToken)}
          onGenerateOg={generateOg}
        />
        <TranslationSection currentLang={form.lang} translations={translations} aiEnabled={aiEnabled} onCreate={createTranslation} />
        <EditorSplitView content={mdContent} onChange={setMdContent} onUploadImage={api.uploadImage} />
      </main>
    </div>
  );
}
