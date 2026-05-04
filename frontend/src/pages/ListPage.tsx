import { useCallback, useEffect, useState } from "react";
import { api, type DraftSummary } from "../api";
import { BatchBar, DraftsGrid, Header, SettingsModal, SyncModal } from "../components/ListComponents";

export function ListPage() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncOpen, setSyncOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      setDrafts(await api.listDrafts());
    } catch (error) {
      alert(`載入失敗：${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  async function createDraft() {
    const draft = await api.createDraft();
    window.location.href = `/editor/${draft.id}`;
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  return (
    <div className="container list-shell">
      <Header
        selectMode={selectMode}
        onToggleSelect={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        onSync={() => setSyncOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onNew={createDraft}
      />
      <main id="drafts-list">
        {loading ? <p className="loading">載入中...</p> : (
          <DraftsGrid
            drafts={drafts}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
            onReload={loadDrafts}
          />
        )}
      </main>
      {selectMode ? <BatchBar selectedIds={selectedIds} onExit={exitSelectMode} onReload={loadDrafts} /> : null}
      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} onReload={loadDrafts} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
