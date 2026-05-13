import React, { useState, useEffect } from "react";
import TopBar from "../components/TopBar";
import PostList from "../components/PostList";
import type { Post } from "../components/PostCard";
import { fetchDrafts } from "../lib/api/drafts";

export default function ListPage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchDrafts()
            .then((data) => {
                const mapped: Post[] = data.map((d) => ({
                    id: d.id,
                    title: d.title,
                    slug: d.slug,
                    lang: d.lang,
                    status: d.status === "published" ? "published" : "draft",
                    updatedAt: d.updated_at?.slice(0, 10) ?? "",
                }));
                setPosts(mapped);
            })
            .catch((err) => setError(String(err)))
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="app min-h-screen bg-gray-50 dark:bg-gray-950">
            <TopBar />
            <div className="max-w-4xl mx-auto py-6">
                {loading && (
                    <p className="text-center text-gray-400 py-24">Loading...</p>
                )}
                {error && (
                    <p className="text-center text-red-500 py-24">{error}</p>
                )}
                {!loading && !error && (
                    <PostList
                        posts={posts}
                        onDelete={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
                    />
                )}
            </div>
        </main>
    );
}
