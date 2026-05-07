import React, { useEffect, useState } from "react";
import { fetchPresets, deletePreset, type TranslationPreset } from "@/lib/api";
import AddPresetForm from "@/components/settings/AddPresetForm";

export default function PresetSettings() {
    const [presets, setPresets] = useState<TranslationPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);

    useEffect(() => {
        fetchPresets()
            .then(setPresets)
            .catch((err: unknown) => {
                console.error("[PresetSettings] fetch error", err);
                setError("無法載入 preset");
            })
            .finally(() => setLoading(false));
    }, []);

    async function handleDelete(id: string) {
        if (!confirm("確定要刪除這個 preset 嗎？")) return;
        await deletePreset(id);
        setPresets((prev) => prev.filter((p) => p.id !== id));
    }

    function handleCreated(preset: TranslationPreset) {
        setPresets((prev) => [...prev, preset]);
        setShowAddForm(false);
    }

    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Preset</h3>
                {!showAddForm && (
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                    >
                        + 新增
                    </button>
                )}
            </div>

            {showAddForm && (
                <AddPresetForm
                    onCreated={handleCreated}
                    onCancel={() => setShowAddForm(false)}
                />
            )}

            {loading && (
                <div className="h-16 flex items-center justify-center text-sm text-gray-400">
                    載入中...
                </div>
            )}

            {error && (
                <div className="text-sm text-red-500">{error}</div>
            )}

            {!loading && !error && presets.length === 0 && (
                <div className="h-16 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                    尚無 preset
                </div>
            )}

            {!loading && !error && presets.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {presets.map((preset) => (
                        <li
                            key={preset.id}
                            className="flex flex-col rounded-md border border-gray-100 dark:border-gray-800 px-3 py-2 gap-2"
                        >
                            <div className="flex flex-wrap gap-1">
                                {(JSON.parse(preset.keywords) as string[]).map((kw) => (
                                    <span
                                        key={kw}
                                        className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                                    >
                                        {kw}
                                    </span>
                                ))}
                            </div>
                            {preset.note && (
                                <span className="text-xs text-gray-400 dark:text-gray-500 break-words">
                                    {preset.note}
                                </span>
                            )}
                            <div className="flex items-center gap-1 self-end">
                                <button className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    編輯
                                </button>
                                <button
                                    onClick={() => handleDelete(preset.id)}
                                    className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                                >
                                    刪除
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
