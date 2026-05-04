import { useEffect, useMemo, useState } from "react";
import { api, type DraftSummary, type GithubPost, type TranslationPreset } from "../api";

type HeaderProps = {
  selectMode: boolean;
  onToggleSelect: () => void;
  onSync: () => void;
  onSettings: () => void;
  onNew: () => void;
};

export function Header({ selectMode, onToggleSelect, onSync, onSettings, onNew }: HeaderProps) {
  return (
    <header>
      <h1>Blog Editor</h1>
      <div className="header-actions">
        <button className="btn btn-secondary icon-btn" title="設定" onClick={onSettings}>⚙</button>
        <button className={`btn btn-secondary ${selectMode ? "btn-active" : ""}`} onClick={onToggleSelect}>
          {selectMode ? "✕ 取消選取" : "☑ 選取模式"}
        </button>
        <button className="btn btn-secondary" onClick={onSync}>↓ 從 GitHub 同步</button>
        <button className="btn btn-primary" onClick={onNew}>+ 新增文章</button>
      </div>
    </header>
  );
}

type DraftsGridProps = {
  drafts: DraftSummary[];
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string, checked: boolean) => void;
  onReload: () => void;
};

export function DraftsGrid({ drafts, selectMode, selectedIds, onToggleSelected, onReload }: DraftsGridProps) {
  if (drafts.length === 0) {
    return <div className="empty-state"><p>還沒有草稿，點擊「新增文章」開始寫吧！</p></div>;
  }

  return (
    <div className="drafts-grid">
      {drafts.map((draft) => (
        <DraftCard
          key={draft.id}
          draft={draft}
          selectMode={selectMode}
          selected={selectedIds.has(draft.id)}
          onToggleSelected={onToggleSelected}
          onReload={onReload}
        />
      ))}
    </div>
  );
}

type DraftCardProps = {
  draft: DraftSummary;
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onReload: () => void;
};

export function DraftCard({ draft, selectMode, selected, onToggleSelected, onReload }: DraftCardProps) {
  const [resyncing, setResyncing] = useState(false);
  const date = new Date(draft.updated_at).toLocaleString("zh-TW");
  const statusBadge = draft.status === "pr_opened"
    ? <span className="badge badge-pr">PR 已開</span>
    : draft.status === "published"
      ? <span className="badge badge-published">已發布</span>
      : <span className="badge badge-draft">草稿</span>;

  async function deleteDraft() {
    if (!confirm("確定要刪除這篇草稿？")) return;
    await api.deleteDraft(draft.id);
    onReload();
  }

  async function resyncDraft() {
    if (!confirm("確定要從 GitHub 重新同步？本地的修改將被覆蓋。")) return;
    setResyncing(true);
    try {
      await api.resyncDraft(draft.id);
      onReload();
    } catch (error) {
      alert(`同步失敗：${(error as Error).message}`);
      setResyncing(false);
    }
  }

  return (
    <div className={`draft-card${selected ? " selected" : ""}`} data-id={draft.id}>
      <label className="draft-select-wrap" style={{ display: selectMode ? "flex" : "none" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggleSelected(draft.id, event.currentTarget.checked)}
        />
      </label>
      <div className="draft-info">
        <div className="draft-title">{draft.title || "(未命名)"}</div>
        <div className="draft-meta">
          {statusBadge} {draft.github_path ? <span className="badge badge-github">GitHub</span> : null} {draft.lang} · 更新 {date}{" "}
          {draft.status === "pr_opened" && draft.pr_url ? (
            <a href={draft.pr_url} target="_blank" rel="noreferrer" className="inline-pr-link">查看 PR →</a>
          ) : null}
        </div>
      </div>
      <div className="draft-actions" style={{ display: selectMode ? "none" : "flex" }}>
        {draft.github_path ? (
          <button className="btn btn-secondary compact-btn" onClick={resyncDraft} disabled={resyncing}>
            {resyncing ? "同步中..." : "重新同步"}
          </button>
        ) : null}
        <button className="btn btn-primary" onClick={() => { window.location.href = `/editor/${draft.id}`; }}>編輯</button>
        <button className="btn btn-danger" onClick={deleteDraft}>刪除</button>
      </div>
    </div>
  );
}

type BatchBarProps = {
  selectedIds: Set<string>;
  onExit: () => void;
  onReload: () => void;
};

export function BatchBar({ selectedIds, onExit, onReload }: BatchBarProps) {
  const [busy, setBusy] = useState<"delete" | "publish" | null>(null);
  const count = selectedIds.size;

  async function batchDelete() {
    const draftIds = [...selectedIds];
    if (draftIds.length === 0) return;
    if (!confirm(`確定要刪除選取的 ${draftIds.length} 篇文章？`)) return;
    if (!confirm(`再次確認：這個動作無法復原，將永久刪除這 ${draftIds.length} 篇文章，確定嗎？`)) return;
    setBusy("delete");
    try {
      await api.batchDelete(draftIds);
      onExit();
      onReload();
    } catch (error) {
      alert(`刪除失敗：${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function batchPublish() {
    const draftIds = [...selectedIds];
    if (draftIds.length === 0) return;
    if (!confirm(`確定要將選取的 ${draftIds.length} 篇文章一起送出 PR？`)) return;
    setBusy("publish");
    try {
      const data = await api.batchPublish(draftIds);
      alert(`成功！已開啟 PR，包含 ${data.count} 篇文章。`);
      if (data.pr_url) window.open(data.pr_url, "_blank");
      onExit();
      onReload();
    } catch (error) {
      alert(`送出失敗：${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="batch-bar">
      <span id="batch-count">已選取 {count} 篇</span>
      <div className="batch-bar-actions">
        <button className="btn btn-secondary" onClick={onExit}>取消</button>
        <button className="btn btn-danger" disabled={count === 0 || busy !== null} onClick={batchDelete}>
          {busy === "delete" ? "刪除中..." : "批量刪除"}
        </button>
        <button className="btn btn-success" disabled={count === 0 || busy !== null} onClick={batchPublish}>
          {busy === "publish" ? "送出中..." : "一起送 PR"}
        </button>
      </div>
    </div>
  );
}

type SyncModalProps = {
  open: boolean;
  onClose: () => void;
  onReload: () => void;
};

export function SyncModal({ open, onClose, onReload }: SyncModalProps) {
  const [posts, setPosts] = useState<GithubPost[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const unsynced = useMemo(() => posts.filter((post) => !post.synced), [posts]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedPaths(new Set());
    api.githubPosts()
      .then(setPosts)
      .catch((error) => alert(`載入失敗：${(error as Error).message}`))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function sync(paths: string[]) {
    if (paths.length === 0) return;
    setSyncing(true);
    try {
      const data = await api.syncPosts(paths);
      const imported = data.imported?.length ?? 0;
      const updated = data.updated?.length ?? 0;
      const errors = data.errors?.length ?? 0;
      let msg = `同步完成！新匯入 ${imported} 篇，更新 ${updated} 篇。`;
      if (errors > 0) msg += `\n錯誤 ${errors} 篇：\n${data.errors!.join("\n")}`;
      alert(msg);
      onReload();
      onClose();
    } catch (error) {
      alert(`同步失敗：${(error as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  function toggle(path: string, checked: boolean) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      checked ? next.add(path) : next.delete(path);
      return next;
    });
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>從 GitHub 同步文章</h2>
          <button className="btn btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? <p className="loading">載入 GitHub 文章中...</p> : null}
          {!loading && posts.length === 0 ? <p className="loading">GitHub 上沒有找到文章。</p> : null}
          {!loading && posts.length > 0 ? (
            <>
              <div className="sync-select-all-wrap">
                <label>
                  <input
                    type="checkbox"
                    checked={unsynced.length > 0 && selectedPaths.size === unsynced.length}
                    onChange={(event) => setSelectedPaths(event.currentTarget.checked ? new Set(unsynced.map((post) => post.path)) : new Set())}
                  />{" "}
                  全選
                </label>
                <small>{unsynced.length} 篇未同步 / 共 {posts.length} 篇</small>
              </div>
              <div className="sync-list">
                {posts.map((post) => (
                  <label key={post.path} className={`sync-row${post.synced ? " sync-row-synced" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={post.synced}
                      checked={selectedPaths.has(post.path)}
                      onChange={(event) => toggle(post.path, event.currentTarget.checked)}
                    />
                    <span className="sync-path">
                      <span className="sync-filename">{post.path.split("/").pop()}</span>
                      <span className="sync-fullpath">{post.path}</span>
                    </span>
                    {post.synced ? <span className="badge badge-github">已同步</span> : null}
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={selectedPaths.size === 0 || syncing} onClick={() => sync([...selectedPaths])}>
            {syncing ? "同步中..." : selectedPaths.size > 0 ? `同步選取 (${selectedPaths.size})` : "同步選取"}
          </button>
        </div>
      </div>
    </div>
  );
}

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [presets, setPresets] = useState<TranslationPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.presets().then(setPresets).catch((error) => alert(`載入失敗：${(error as Error).message}`));
  }, [open]);

  if (!open) return null;

  function resetForm() {
    setEditingId(null);
    setKeywords([]);
    setKeywordInput("");
    setTranslations({});
    setNote("");
  }

  function editPreset(preset: TranslationPreset) {
    setEditingId(preset.id);
    setKeywords(JSON.parse(preset.keywords || "[]"));
    setTranslations(JSON.parse(preset.translations || "{}"));
    setNote(preset.note || "");
  }

  function commitKeyword() {
    const val = keywordInput.replaceAll(",", "").trim();
    if (!val) return;
    setKeywords((prev) => [...prev, val]);
    setKeywordInput("");
  }

  async function savePreset() {
    commitKeyword();
    const nextKeywords = keywordInput.trim() ? [...keywords, keywordInput.replaceAll(",", "").trim()] : keywords;
    if (nextKeywords.length === 0) {
      alert("請至少輸入一個關鍵字。");
      return;
    }
    setSaving(true);
    try {
      await api.savePreset({ keywords: nextKeywords, translations, note }, editingId);
      resetForm();
      setPresets(await api.presets());
    } catch (error) {
      alert(`儲存失敗：${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deletePreset(id: string) {
    if (!confirm("確定要刪除這個常用翻譯？")) return;
    await api.deletePreset(id);
    setPresets(await api.presets());
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal modal-settings">
        <div className="modal-header">
          <h2>設定</h2>
          <button className="btn btn-secondary" onClick={() => { resetForm(); onClose(); }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-section-header">
              <h3>常用翻譯設定</h3>
              <button className="btn btn-primary compact-btn" onClick={resetForm}>+ 新增</button>
            </div>
            <p className="settings-hint">設定特定詞彙的固定翻譯，AI 翻譯時會自動套用對應詞彙。</p>
            <div className="preset-form">
              <div className="preset-form-field full-width">
                <label>關鍵字 <small>（Enter 或逗號新增，可多個）</small></label>
                <div className="tags-input-wrap">
                  {keywords.map((keyword) => (
                    <span className="tag-chip" key={keyword}>
                      {keyword}<button className="tag-chip-remove" onClick={() => setKeywords((prev) => prev.filter((k) => k !== keyword))}>×</button>
                    </span>
                  ))}
                  <input
                    className="tags-input"
                    value={keywordInput}
                    placeholder="輸入關鍵字..."
                    onChange={(event) => setKeywordInput(event.currentTarget.value)}
                    onBlur={commitKeyword}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === ",") && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        commitKeyword();
                      }
                    }}
                  />
                </div>
              </div>
              {([
                ["zh-tw", "繁體中文 (zh-tw)", "中文翻譯"],
                ["en", "English (en)", "English translation"],
                ["ja", "日本語 (ja)", "日本語訳"],
              ] as const).map(([lang, label, placeholder]) => (
                <div className="preset-form-field" key={lang}>
                  <label>{label}</label>
                  <input
                    className="field-input"
                    value={translations[lang] ?? ""}
                    placeholder={placeholder}
                    onChange={(event) => setTranslations((prev) => ({ ...prev, [lang]: event.currentTarget.value }))}
                  />
                </div>
              ))}
              <div className="preset-form-field full-width">
                <label>補充說明</label>
                <textarea className="field-input" rows={2} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
              </div>
              <div className="preset-form-actions">
                <button className="btn btn-secondary" onClick={resetForm}>取消</button>
                <button className="btn btn-primary" disabled={saving} onClick={savePreset}>{saving ? "儲存中..." : "儲存"}</button>
              </div>
            </div>
            <div id="presets-list">
              {presets.length === 0 ? <p className="muted-row">尚未設定任何常用翻譯。</p> : null}
              {presets.map((preset) => {
                const presetKeywords = JSON.parse(preset.keywords || "[]") as string[];
                const presetTranslations = JSON.parse(preset.translations || "{}") as Record<string, string>;
                return (
                  <div className="preset-item" key={preset.id}>
                    <div className="preset-item-info">
                      <div className="preset-keywords">
                        {presetKeywords.map((keyword) => <span className="preset-keyword-chip" key={keyword}>{keyword}</span>)}
                      </div>
                      <div className="preset-translations">
                        {["zh-tw", "en", "ja"].filter((lang) => presetTranslations[lang]).map((lang) => `${lang}: ${presetTranslations[lang]}`).join(" · ")}
                      </div>
                      {preset.note ? <div className="preset-note">{preset.note}</div> : null}
                    </div>
                    <div className="preset-item-actions">
                      <button className="btn btn-secondary compact-btn" onClick={() => editPreset(preset)}>編輯</button>
                      <button className="btn btn-danger compact-btn" onClick={() => deletePreset(preset.id)}>刪除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
