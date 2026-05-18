import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface SelectModeBarProps {
    selectedCount: number;
    onCancel: () => void;
    onBulkDelete: () => Promise<void>;
    onBulkPushPR: () => Promise<void>;
}

export default function SelectModeBar({ selectedCount, onCancel, onBulkDelete, onBulkPushPR }: SelectModeBarProps) {
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [bulkPushing, setBulkPushing] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [pushError, setPushError] = useState<string | null>(null);

    async function handleBulkDelete() {
        setBulkDeleting(true);
        setDeleteError(null);
        try {
            await onBulkDelete();
            setDeleteConfirmOpen(false);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : "刪除失敗，請再試一次");
        } finally {
            setBulkDeleting(false);
        }
    }

    async function handleBulkPushPR() {
        setBulkPushing(true);
        setPushError(null);
        try {
            await onBulkPushPR();
        } catch (err) {
            setPushError(err instanceof Error ? err.message : "推送失敗，請再試一次");
        } finally {
            setBulkPushing(false);
        }
    }

    return (
        <>
            <div className="flex flex-col border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40">
                <div className="flex items-center gap-3 px-6 py-2.5">
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300 flex-1">
                        已選取 {selectedCount} 篇
                    </span>
                    <button
                        className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-white dark:hover:bg-gray-800 rounded-md transition-colors"
                        onClick={onCancel}
                    >
                        取消
                    </button>
                    <button
                        className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors"
                        onClick={handleBulkPushPR}
                        disabled={selectedCount === 0 || bulkPushing}
                    >
                        {bulkPushing ? "推送中..." : `Push PR (${selectedCount})`}
                    </button>
                    <button
                        className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-md transition-colors"
                        onClick={() => { setDeleteError(null); setDeleteConfirmOpen(true); }}
                        disabled={selectedCount === 0}
                    >
                        {`刪除 (${selectedCount})`}
                    </button>
                </div>
                {pushError && (
                    <p className="px-6 pb-2.5 text-sm text-red-600 dark:text-red-400">{pushError}</p>
                )}
            </div>

            <Dialog open={deleteConfirmOpen} onOpenChange={(open) => !bulkDeleting && setDeleteConfirmOpen(open)}>
                <DialogContent showCloseButton={!bulkDeleting}>
                    <DialogHeader>
                        <DialogTitle>確認批量刪除</DialogTitle>
                        <DialogDescription>
                            確定要刪除選取的 {selectedCount} 篇文章嗎？這個操作無法復原。
                        </DialogDescription>
                    </DialogHeader>
                    {deleteError && (
                        <p className="text-sm text-red-500 dark:text-red-400">{deleteError}</p>
                    )}
                    <DialogFooter>
                        <button
                            onClick={() => setDeleteConfirmOpen(false)}
                            disabled={bulkDeleting}
                            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleBulkDelete}
                            disabled={bulkDeleting}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-md transition-colors"
                        >
                            {bulkDeleting ? "刪除中..." : "確認刪除"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
