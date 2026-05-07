import React, { useRef, useState } from "react";
import { createPreset, type TranslationPreset } from "@/lib/api";

interface AddPresetFormProps {
    onCreated: (preset: TranslationPreset) => void;
    onCancel: () => void;
}

export default function AddPresetForm({ onCreated, onCancel }: AddPresetFormProps) {
    const [keywords, setKeywords] = useState<string[]>([]);
    const [kwInput, setKwInput] = useState("");
    const [pairs, setPairs] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const kwInputRef = useRef<HTMLInputElement>(null);

    function addKeyword() {
        const trimmed = kwInput.trim();
        if (trimmed && !keywords.includes(trimmed)) {
            setKeywords((prev) => [...prev, trimmed]);
        }
        setKwInput("");
    }

    function removeKeyword(kw: string) {
        setKeywords((prev) => prev.filter((k) => k !== kw));
    }

    function updatePair(index: number, field: "key" | "value", value: string) {
        setPairs((prev) => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
    }

    function addPair() {
        setPairs((prev) => [...prev, { key: "", value: "" }]);
    }

    function removePair(index: number) {
        setPairs((prev) => prev.filter((_, i) => i !== index));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (keywords.length === 0) return;
        setSubmitting(true);
        try {
            const translations = Object.fromEntries(
                pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value.trim()])
            );
            const preset = await createPreset({ keywords, translations, note });
            onCreated(preset);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-3">
            {/* Keywords */}
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Keywords</label>
                <div className="flex flex-wrap gap-1 min-h-7">
                    {keywords.map((kw) => (
                        <span key={kw} className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                            {kw}
                            <button type="button" onClick={() => removeKeyword(kw)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">×</button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-1">
                    <input
                        ref={kwInputRef}
                        value={kwInput}
                        onChange={(e) => setKwInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                        placeholder="輸入後按 Enter 新增"
                        className="flex-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <button type="button" onClick={addKeyword} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                        +
                    </button>
                </div>
            </div>

            {/* Translations */}
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Translations</label>
                <div className="flex flex-col gap-1">
                    {pairs.map((pair, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1">
                            <input
                                value={pair.key}
                                onChange={(e) => updatePair(i, "key", e.target.value)}
                                placeholder="原文"
                                className="min-w-0 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <span className="text-gray-400 text-xs text-center">→</span>
                            <input
                                value={pair.value}
                                onChange={(e) => updatePair(i, "value", e.target.value)}
                                placeholder="譯文"
                                className="min-w-0 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <button
                                type="button"
                                onClick={() => removePair(i)}
                                disabled={pairs.length === 1}
                                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30 px-1"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addPair} className="self-start text-xs text-blue-500 hover:text-blue-400 mt-0.5">
                        + 新增翻譯
                    </button>
                </div>
            </div>

            {/* Note */}
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Note</label>
                <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="備註（選填）"
                    className="text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                />
            </div>

            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="text-xs px-3 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    取消
                </button>
                <button
                    type="submit"
                    disabled={submitting || keywords.length === 0}
                    className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                    {submitting ? "新增中..." : "新增"}
                </button>
            </div>
        </form>
    );
}
