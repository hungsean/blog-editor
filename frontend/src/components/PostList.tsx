import React from "react";
import PostCard, { type Post } from "./PostCard";

interface PostListProps {
    posts: Post[];
    onDelete?: (id: string) => void;
    onSynced?: () => void;
    selectMode?: boolean;
    selectedIds?: Set<string>;
    onToggleSelect?: (id: string) => void;
}

export default function PostList({ posts, onDelete, onSynced, selectMode, selectedIds, onToggleSelect }: PostListProps) {
    if (posts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400 dark:text-gray-600">
                <p className="text-base">No posts yet.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {posts.map((post) => (
                <PostCard
                    key={post.id}
                    post={post}
                    onDelete={onDelete}
                    onSynced={onSynced}
                    selectMode={selectMode}
                    selected={selectedIds?.has(post.id) ?? false}
                    onToggleSelect={onToggleSelect}
                />
            ))}
        </div>
    );
}
