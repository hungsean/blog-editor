import React from "react";
import TopBar from "../components/TopBar";
import PostList from "../components/PostList";
import type { Post } from "../components/PostCard";

const MOCK_POSTS: Post[] = [
    {
        id: 1,
        title: "Getting Started with Bun",
        slug: "getting-started-with-bun",
        lang: "en",
        status: "published",
        updatedAt: "2026-05-01",
    },
    {
        id: 2,
        title: "TypeScript 最佳實踐",
        slug: "typescript-best-practices",
        lang: "zh",
        status: "published",
        updatedAt: "2026-04-28",
    },
    {
        id: 3,
        title: "React 效能優化筆記",
        slug: "react-performance-notes",
        lang: "zh",
        status: "draft",
        updatedAt: "2026-04-20",
    },
    {
        id: 4,
        title: "Building a Blog with Markdown",
        slug: "blog-with-markdown",
        lang: "en",
        status: "draft",
        updatedAt: "2026-04-15",
    },
];

export default function ListPage() {
    return (
        <main className="app min-h-screen bg-gray-50 dark:bg-gray-950">
            <TopBar />
            <div className="max-w-4xl mx-auto py-6">
                <PostList
                    posts={MOCK_POSTS}
                />
            </div>
        </main>
    );
}
