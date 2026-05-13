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

export interface Post {
    id: string;
    title: string;
    slug: string;
    lang: string;
    status: "published" | "draft";
    updatedAt: string;
}

interface PostCardProps {
    post: Post;
    onDelete?: (id: string) => void;
}

const STATUS_STYLES = {
    published: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
};

export default function PostCard({ post, onDelete }: PostCardProps) {
    const [, navigate] = useLocation();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const handleEdit = (post: Post) => {
        navigate(`/editor/${post.id}`);
    };

    const handleSync = (_post: Post) => {
    };

    const handleOpenChange = (open: boolean) => {
        if (deleting) return;
        setConfirmOpen(open);
        if (!open) setDeleteError(null);
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
            <div className="flex items-stretch gap-4 px-6 py-4 bg-white dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
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
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => handleSync(post)}
                        className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    >
                        Sync
                    </button>
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
            </div>

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
