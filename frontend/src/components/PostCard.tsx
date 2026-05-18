import React, { useState } from "react";
import { useLocation } from "wouter";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { deleteDraft } from "../lib/api/drafts";
import { syncFromGithub } from "../lib/api/github";

export interface Post {
    id: string;
    title: string;
    slug: string;
    lang: string;
    status: "published" | "draft" | "pr_opened";
    updatedAt: string;
    github_path: string;
}

interface PostCardProps {
    post: Post;
    onDelete?: (id: string) => void;
    /** 單篇 sync 成功後呼叫，讓列表重新載入以反映被覆蓋的內容。 */
    onSynced?: () => void;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: (id: string) => void;
}

const STATUS_STYLES: Record<Post["status"], string> = {
    published: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    pr_opened: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function PostCard({ post, onDelete, onSynced, selectMode = false, selected = false, onToggleSelect }: PostCardProps) {
    const [, navigate] = useLocation();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    const handleEdit = (post: Post) => {
        navigate(`/editor/${post.id}`);
    };

    const handleOpenChange = (open: boolean) => {
        if (deleting) return;
        setConfirmOpen(open);
        if (!open) setDeleteError(null);
    };

    const handleSyncOpenChange = (open: boolean) => {
        if (syncing) return;
        setSyncConfirmOpen(open);
        if (!open) setSyncError(null);
    };

    const confirmSync = async () => {
        setSyncing(true);
        setSyncError(null);
        try {
            await syncFromGithub([post.github_path], true);
            setSyncConfirmOpen(false);
            onSynced?.();
        } catch (err) {
            setSyncError(err instanceof Error ? err.message : "同步失敗，請再試一次");
        } finally {
            setSyncing(false);
        }
    };

    const confirmDelete = async () => {
        setDeleting(true);
        setDeleteError(null);
        try {
            await deleteDraft(post.id);
            setConfirmOpen(false);
            onDelete?.(post.id);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : "刪除失敗，請再試一次");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            <div
                className={`flex items-stretch gap-4 px-6 py-4 bg-white dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800 transition-colors ${
                    selectMode
                        ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30" + (selected ? " bg-blue-50 dark:bg-blue-950/30" : "")
                        : "hover:bg-gray-50 dark:hover:bg-gray-900"
                }`}
                onClick={selectMode ? () => onToggleSelect?.(post.id) : undefined}
            >
                {selectMode && (
                    <div className="flex items-center shrink-0">
                        <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggleSelect?.(post.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-blue-600"
                        />
                    </div>
                )}

                {/* Information area */}
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">
                            {post.title}
                        </h2>
                        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[post.status]}`}>
                            {post.status}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-gray-500">
                        <span>{post.slug}</span>
                        <span>·</span>
                        <span>{post.lang.toUpperCase()}</span>
                        <span>·</span>
                        <span>{post.updatedAt}</span>
                    </div>
                </div>

                {/* Button area */}
                {!selectMode && (
                    <div className="flex items-center gap-2 shrink-0">
                        {post.status === "published" && (
                            <button
                                onClick={() => setSyncConfirmOpen(true)}
                                className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                            >
                                Sync
                            </button>
                        )}
                        <button
                            onClick={() => handleEdit(post)}
                            className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
                        >
                            Edit
                        </button>
                        <button
                            onClick={() => setConfirmOpen(true)}
                            className="px-3 py-1.5 text-sm font-medium text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                )}
            </div>

            <Dialog open={syncConfirmOpen} onOpenChange={handleSyncOpenChange}>
                <DialogContent showCloseButton={!syncing}>
                    <DialogHeader>
                        <DialogTitle>確認同步</DialogTitle>
                        <DialogDescription>
                            將從 GitHub 覆蓋「{post.title}」的本地內容，此操作無法復原。
                        </DialogDescription>
                    </DialogHeader>
                    {syncError && (
                        <p className="text-sm text-red-500 dark:text-red-400">{syncError}</p>
                    )}
                    <DialogFooter>
                        <button
                            onClick={() => handleSyncOpenChange(false)}
                            disabled={syncing}
                            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={confirmSync}
                            disabled={syncing}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 rounded-md transition-colors"
                        >
                            {syncing ? "同步中..." : "確認覆蓋"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={confirmOpen} onOpenChange={handleOpenChange}>
                <DialogContent showCloseButton={!deleting}>
                    <DialogHeader>
                        <DialogTitle>確認刪除</DialogTitle>
                        <DialogDescription>
                            確定要刪除「{post.title}」嗎？這個操作無法復原。
                        </DialogDescription>
                    </DialogHeader>
                    {deleteError && (
                        <p className="text-sm text-red-500 dark:text-red-400">{deleteError}</p>
                    )}
                    <DialogFooter>
                        <button
                            onClick={() => handleOpenChange(false)}
                            disabled={deleting}
                            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={confirmDelete}
                            disabled={deleting}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-md transition-colors"
                        >
                            {deleting ? "刪除中..." : "確認刪除"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
