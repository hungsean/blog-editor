import React, { useState } from "react";
import { useLocation } from "wouter";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import PresetSettings from "@/components/settings/PresetSettings";
import { createDraft } from "@/lib/api/drafts";

export default function TopBar() {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [, navigate] = useLocation();
    const [creating, setCreating] = useState(false);

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
            <div className="flex items-center gap-2">
                <button
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    onClick={() => setSettingsOpen(true)}
                >
                    Settings
                </button>
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
                <button className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors">
                    Select Mode
                </button>
                <button className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors">
                    Sync from GitHub
                </button>
                <button
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors"
                    onClick={handleNewPost}
                    disabled={creating}
                >
                    {creating ? "Creating..." : "New Post"}
                </button>
            </div>
        </header>
    );
}
