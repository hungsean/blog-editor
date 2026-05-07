import React, { useRef, useState } from "react";

export const SUPPORTED_LANGUAGES = ["en", "ja"] as const;
export type Lang = typeof SUPPORTED_LANGUAGES[number];

export interface PresetFormValues {
    keywords: string[];
    translations: Record<Lang, string>;
    note: string;
}

interface PresetFormProps {
    initialValues?: Partial<PresetFormValues>;
    onSubmit: (values: PresetFormValues) => Promise<void>;
    onCancel: () => void;
    submitLabel?: string;
}

export default function PresetForm({ initialValues, onSubmit, onCancel, submitLabel = "送出" }: PresetFormProps) {
    const [keywords, setKeywords] = useState<string[]>(initialValues?.keywords ?? []);
    const [kwInput, setKwInput] = useState("");
    const [translations, setTranslations] = useState<Record<Lang, string>>(
        initialValues?.translations ??
        (Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, ""])) as Record<Lang, string>)
    );
    const [note, setNote] = useState(initialValues?.note ?? "");
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

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (keywords.length === 0) return;
        setSubmitting(true);
        try {
            await onSubmit({ keywords, translations, note });
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
                    {SUPPORTED_LANGUAGES.map((lang) => (
                        <div key={lang} className="grid grid-cols-[2rem_auto_1fr] items-center gap-2">
                            <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{lang}</span>
                            <span className="text-gray-400 text-xs">→</span>
                            <input
                                value={translations[lang]}
                                onChange={(e) => setTranslations((prev) => ({ ...prev, [lang]: e.target.value }))}
                                placeholder={`${lang} 譯文`}
                                className="min-w-0 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Note */}
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Note</label>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="備註（選填）"
                    rows={3}
                    className="text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400 resize-none"
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
                    {submitting ? "處理中..." : submitLabel}
                </button>
            </div>
        </form>
    );
}
