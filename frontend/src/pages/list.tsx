import React, { useState, useEffect, useCallback } from "react";
import TopBar from "../components/TopBar";
import SelectModeBar from "../components/SelectModeBar";
import PostList from "../components/PostList";
import type { Post } from "../components/PostCard";
import { ListProvider } from "../contexts/ListContext";
import { fetchDrafts, bulkDeleteDrafts, bulkPublishDrafts } from "../lib/api/drafts";

/**
 * 從 draft 的 `fields` JSON 字串取出 pubDate，取不到時回傳空字串。
 *
 * @remarks
 * pubDate 與 nsfw、ogImage 一起存在 `fields` JSON 欄位裡（與後端 schema 一致），
 * 解析方式刻意對齊編輯器的 draftToFields，避免兩邊各自一套。
 */
function parsePubDate(fields: string): string {
    try {
        const parsed = JSON.parse(fields || "{}");
        return typeof parsed.pubDate === "string" ? parsed.pubDate : "";
    } catch {
        return "";
    }
}

export default function ListPage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const loadDrafts = useCallback(() => {
        setLoading(true);
        fetchDrafts()
            .then((data) => {
                const mapped: Post[] = data.map((d) => ({
                    id: d.id,
                    title: d.title,
                    slug: d.slug,
                    lang: d.lang,
                    status: d.status === "published" ? "published" : d.status === "pr_opened" ? "pr_opened" : "draft",
                    pubDate: parsePubDate(d.fields),
                    github_path: d.github_path ?? "",
                }));
                setPosts(mapped);
            })
            .catch((err) => setError(String(err)))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { loadDrafts(); }, [loadDrafts]);

    const toggleSelectMode = useCallback(() => {
        setSelectMode((prev) => !prev);
        setSelectedIds(new Set());
    }, []);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleBulkDelete = useCallback(async () => {
        const { deleted } = await bulkDeleteDrafts([...selectedIds]);
        setPosts((prev) => prev.filter((p) => !deleted.includes(p.id)));
        setSelectedIds(new Set());
        setSelectMode(false);
    }, [selectedIds]);

    const handleBulkPushPR = useCallback(async () => {
        const result = await bulkPublishDrafts([...selectedIds]);
        if (!result.success) {
            throw new Error(result.error);
        }
        const publishedIds = new Set(selectedIds);
        setPosts((prev) => prev.map((p) => publishedIds.has(p.id) ? { ...p, status: "pr_opened" as const } : p));
        setSelectedIds(new Set());
        setSelectMode(false);
    }, [selectedIds]);

    return (
        <ListProvider
            selectMode={selectMode}
            selectedIds={selectedIds}
            toggleSelect={toggleSelect}
            onDelete={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
            onSynced={loadDrafts}
        >
            <main className="app min-h-screen bg-gray-50 dark:bg-gray-950">
                <TopBar selectMode={selectMode} onToggleSelectMode={toggleSelectMode} onSynced={loadDrafts} />
                {selectMode && (
                    <SelectModeBar
                        selectedCount={selectedIds.size}
                        onCancel={toggleSelectMode}
                        onBulkDelete={handleBulkDelete}
                        onBulkPushPR={handleBulkPushPR}
                    />
                )}
                <div className="max-w-4xl mx-auto py-6">
                    {loading && (
                        <p className="text-center text-gray-400 py-24">Loading...</p>
                    )}
                    {error && (
                        <p className="text-center text-red-500 py-24">{error}</p>
                    )}
                    {!loading && !error && <PostList posts={posts} />}
                </div>
            </main>
        </ListProvider>
    );
}
