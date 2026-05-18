import React from "react";
import { updatePreset, type TranslationPreset } from "@/lib/api/presets";
import PresetForm, { type Lang, type PresetFormValues, SUPPORTED_LANGUAGES } from "@/components/settings/PresetForm";

interface EditPresetFormProps {
    preset: TranslationPreset;
    onUpdated: (preset: TranslationPreset) => void;
    onCancel: () => void;
}

export default function EditPresetForm({ preset, onUpdated, onCancel }: EditPresetFormProps) {
    const initialValues: PresetFormValues = {
        keywords: JSON.parse(preset.keywords) as string[],
        translations: (() => {
            const parsed = JSON.parse(preset.translations) as Record<string, string>;
            return Object.fromEntries(
                SUPPORTED_LANGUAGES.map((lang) => [lang, parsed[lang] ?? ""])
            ) as Record<Lang, string>;
        })(),
        note: preset.note,
    };

    async function handleSubmit(values: PresetFormValues) {
        const filteredTranslations = Object.fromEntries(
            Object.entries(values.translations).filter(([, v]) => v.trim())
        );
        const updated = await updatePreset(preset.id, {
            keywords: values.keywords,
            translations: filteredTranslations,
            note: values.note,
        });
        onUpdated(updated);
    }

    return <PresetForm initialValues={initialValues} onSubmit={handleSubmit} onCancel={onCancel} submitLabel="儲存" />;
}
