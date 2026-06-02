import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../../ui/dialog";
import { Button } from "../../ui/button";
import { createDraft } from "../../../lib/api/drafts";
import { translateContent } from "../../../lib/api/translation";
import { langLabel } from "../../../lib/langs";
import { useEditor } from "../../../contexts/EditorContext";

interface TranslationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 翻譯目標語言代碼。 */
  targetLang: string;
}

type Status = "confirm" | "translating" | "error";

/**
 * 翻譯確認 + 進度對話框。
 *
 * @remarks
 * 確認後呼叫 `/api/translation` 翻譯，再以結果 `createDraft` 建立目標語言的新草稿，
 * 完成後導航到新草稿。翻譯後的新草稿沿用來源的 slug、tags、pubDate、nsfw、ogImage，
 * 只有 title/description/content 換成翻譯結果。導航會連同本對話框一起卸載。
 */
export default function TranslationDialog({
  open,
  onOpenChange,
  targetLang,
}: Readonly<TranslationDialogProps>) {
  const { fields, content } = useEditor();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<Status>("confirm");
  const [error, setError] = useState<string | null>(null);

  // 每次開啟時重設回確認步驟。
  useEffect(() => {
    if (open) {
      setStatus("confirm");
      setError(null);
    }
  }, [open]);

  const label = langLabel(targetLang);

  async function handleTranslate() {
    setStatus("translating");
    setError(null);
    try {
      const translated = await translateContent({
        title: fields.title,
        description: fields.description,
        content,
        sourceLang: fields.lang,
        targetLang,
      });

      const extra: Record<string, unknown> = {};
      if (fields.pubDate) extra.pubDate = fields.pubDate;
      if (fields.nsfw) extra.nsfw = fields.nsfw;
      if (fields.ogImage) extra.ogImage = fields.ogImage;

      const draft = await createDraft({
        title: translated.title,
        description: translated.description,
        content: translated.content,
        slug: fields.slug,
        lang: targetLang,
        tags: JSON.stringify(fields.tags),
        fields: JSON.stringify(extra),
      });

      navigate(`/editor/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={status !== "translating"}>
        <DialogHeader>
          <DialogTitle>翻譯成 {label}</DialogTitle>
          <DialogDescription>
            將以 AI 把這篇文章翻譯成 {label}，並建立一篇新草稿，完成後會自動跳轉過去。
          </DialogDescription>
        </DialogHeader>

        {status === "translating" && (
          <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            翻譯中...（約需 10～30 秒）
          </div>
        )}
        {status === "error" && (
          <p className="py-2 text-sm text-red-500 dark:text-red-400">
            翻譯失敗：{error}
          </p>
        )}

        {status !== "translating" && (
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
            <Button onClick={handleTranslate}>
              {status === "error" ? "重試" : "開始翻譯"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
