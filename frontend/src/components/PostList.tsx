import React from "react";
import PostCard, { type Post } from "./PostCard";

interface PostListProps {
    posts: Post[];
}

export default function PostList({ posts }: Readonly<PostListProps>) {
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
                <PostCard key={post.id} post={post} />
            ))}
        </div>
    );
}
