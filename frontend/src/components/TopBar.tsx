import { useState } from "react";
import { useLocation } from "wouter";
import { Menu } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import PresetSettings from "@/components/settings/PresetSettings";
import { createDraft } from "@/lib/api/drafts";
import { fetchGithubPosts, syncFromGithub } from "@/lib/api/github";

interface TopBarProps {
    selectMode?: boolean;
    onToggleSelectMode?: () => void;
    onSynced?: () => void;
}

interface TopBarActionsProps {
    /** `bar` 為桌機行內橫列；`menu` 為手機折疊選單，按鈕改為整列點擊。 */
    variant: "bar" | "menu";
    selectMode: boolean;
    syncing: boolean;
    creating: boolean;
    onSettings: () => void;
    onToggleSelectMode?: () => void;
    onSync: () => void;
    onNewPost: () => void;
}

/**
 * TopBar 的四顆動作按鈕（Settings / Select Mode / Sync / New Post）。
 *
 * @remarks
 * 桌機橫列與手機折疊選單共用同一組按鈕，靠 `variant` 切換版面 class，
 * 避免兩處各自維護一份按鈕而走樣。`menu` 變體下按鈕為 `w-full text-left`，
 * 在 Popover 內排成垂直清單。
 */
function TopBarActions({
    variant,
    selectMode,
    syncing,
    creating,
    onSettings,
    onToggleSelectMode,
    onSync,
    onNewPost,
}: TopBarActionsProps) {
    const base = "px-3 py-1.5 text-sm font-medium rounded-md transition-colors";
    const layout = variant === "menu" ? " w-full text-left" : "";

    return (
        <>
            <button
                className={`${base}${layout} text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800`}
                onClick={onSettings}
            >
                Settings
            </button>
            <button
                className={`${base}${layout} ${
                    selectMode
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onClick={onToggleSelectMode}
            >
                Select Mode
            </button>
            <button
                className={`${base}${layout} text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50`}
                onClick={onSync}
                disabled={syncing}
            >
                {syncing ? "Syncing..." : "Sync from GitHub"}
            </button>
            <button
                className={`${base}${layout} text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50`}
                onClick={onNewPost}
                disabled={creating}
            >
                {creating ? "Creating..." : "New Post"}
            </button>
        </>
    );
}

export default function TopBar({ selectMode = false, onToggleSelectMode, onSynced }: TopBarProps) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [, navigate] = useLocation();
    const [creating, setCreating] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    async function handleSync() {
        if (syncing) return;
        setSyncing(true);
        try {
            const posts = await fetchGithubPosts();
            const paths = posts.map((p) => p.path);
            if (paths.length > 0) {
                const result = await syncFromGithub(paths);
                if (result.errors.length > 0) {
                    console.error("[sync] partial failures:", result.errors);
                }
                if (result.imported.length > 0 || result.updated.length > 0) {
                    onSynced?.();
                }
            }
        } finally {
            setSyncing(false);
        }
    }

    async function handleNewPost() {
        if (creating) return;
        setCreating(true);
        try {
            const draft = await createDraft();
            navigate(`/editor/${draft.id}`);
        } finally {
            setCreating(false);
        }
    }

    return (
        <header className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">Blog Editor</span>

            <div className="flex items-center">
                {/* 桌機：行內橫列按鈕 */}
                <div className="hidden sm:flex items-center gap-2">
                    <TopBarActions
                        variant="bar"
                        selectMode={selectMode}
                        syncing={syncing}
                        creating={creating}
                        onSettings={() => setSettingsOpen(true)}
                        onToggleSelectMode={onToggleSelectMode}
                        onSync={handleSync}
                        onNewPost={handleNewPost}
                    />
                </div>

                {/* 手機：折疊選單 */}
                <div className="sm:hidden">
                    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                        <PopoverTrigger
                            aria-label="開啟選單"
                            className="flex items-center justify-center p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                            <Menu className="size-5" />
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-44 gap-1 p-1.5">
                            <TopBarActions
                                variant="menu"
                                selectMode={selectMode}
                                syncing={syncing}
                                creating={creating}
                                onSettings={() => {
                                    setMenuOpen(false);
                                    setSettingsOpen(true);
                                }}
                                onToggleSelectMode={() => {
                                    setMenuOpen(false);
                                    onToggleSelectMode?.();
                                }}
                                onSync={() => {
                                    setMenuOpen(false);
                                    handleSync();
                                }}
                                onNewPost={() => {
                                    setMenuOpen(false);
                                    handleNewPost();
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Settings 對話框：由 settingsOpen 控制，與選單開關獨立 */}
                <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Settings</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col gap-4 py-2">
                            <PresetSettings />
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </header>
    );
}
