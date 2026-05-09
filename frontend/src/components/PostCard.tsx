import React from "react";

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
}

const STATUS_STYLES = {
    published: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
};

export default function PostCard({ post }: PostCardProps) {
    const handleEdit = (post: Post) => {
    };

    const handleSync = (post: Post) => {
    };

    const handleDelete = (post: Post) => {
    };

    return (
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
                    onClick={() => handleDelete(post)}
                    className="px-3 py-1.5 text-sm font-medium text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}
