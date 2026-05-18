import React from "react";
import { createPreset, type TranslationPreset } from "@/lib/api/presets";
import PresetForm, { type PresetFormValues } from "@/components/settings/PresetForm";

interface AddPresetFormProps {
    onCreated: (preset: TranslationPreset) => void;
    onCancel: () => void;
}

export default function AddPresetForm({ onCreated, onCancel }: AddPresetFormProps) {
    async function handleSubmit(values: PresetFormValues) {
        const filteredTranslations = Object.fromEntries(
            Object.entries(values.translations).filter(([, v]) => v.trim())
        );
        const preset = await createPreset({
            keywords: values.keywords,
            translations: filteredTranslations,
            note: values.note,
        });
        onCreated(preset);
    }

    return <PresetForm onSubmit={handleSubmit} onCancel={onCancel} submitLabel="新增" />;
}
