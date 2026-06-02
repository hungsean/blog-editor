import { useEffect, useState } from "react";
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
import ImageLibrary from "../ImageLibrary";
import type { ImageItem } from "../../../lib/api/images";
import { generateOgPreview, uploadOgImage } from "../../../lib/api/og";
import { useEditor } from "../../../contexts/EditorContext";

interface OgImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `pick` — 單步：挑一張現成圖直接當 ogImage。
   * `generate` — 兩步驟：選 hero 圖 → 套模板生成 OG 卡片 → 上傳 R2。
   */
  mode: "pick" | "generate";
}

type GenStatus = "idle" | "loading" | "ready" | "error";

/** 對話框的三種畫面：生成預覽、生成選圖、單純選圖。 */
type OgStage = "preview" | "generate" | "pick";

const STAGE_COPY: Record<OgStage, { title: string; description: string }> = {
  preview: {
    title: "生成 OG 圖 — 預覽",
    description: "確認生成結果，沒問題就上傳到 R2 並套用。",
  },
  generate: {
    title: "生成 OG 圖 — 選擇圖片",
    description: "選一張 hero 圖片，下一步會套模板生成 OG 卡片。",
  },
  pick: {
    title: "選擇 OG 圖片",
    description: "從圖片庫挑一張圖片作為 OG Image。",
  },
};

/**
 * OG 圖片挑選／生成對話框。
 *
 * @remarks
 * `pick` 與 `generate` 共用第一步「選圖」UI（{@link ImageLibrary} + 預覽區）。
 * `generate` 的第二步會呼叫 `/api/og/preview` 生成 PNG 預覽，確認後把同一個 blob
 * 送到 `/api/og/upload`，避免重複生成。
 */
export default function OgImageDialog({
  open,
  onOpenChange,
  mode,
}: Readonly<OgImageDialogProps>) {
  const { draftId, fields, updateFields } = useEditor();
  // 生成 OG 卡片所需的文章資料，從共享 fields 就地組出。
  const meta = {
    title: fields.title,
    description: fields.description,
    date: fields.pubDate,
    tags: fields.tags,
  };
  const [selected, setSelected] = useState<ImageItem | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開啟時重置所有狀態。
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setStep(1);
    setGenStatus("idle");
    setPreviewBlob(null);
    setPreviewUrl(null);
    setUploading(false);
    setError(null);
  }, [open]);

  // previewUrl 變動或卸載時回收前一個 object URL。
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // 進入第二步時生成 OG 預覽圖。
  useEffect(() => {
    if (mode !== "generate" || step !== 2 || !selected) return;
    let cancelled = false;
    setGenStatus("loading");
    setError(null);
    generateOgPreview({
      title: meta.title,
      description: meta.description || undefined,
      date: meta.date || undefined,
      tags: meta.tags,
      heroImageUrl: selected.url,
    })
      .then((blob) => {
        if (cancelled) return;
        setPreviewBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setGenStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setGenStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // meta 於 effect 執行當下擷取，不列入依賴避免每次 render 重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step, selected]);

  function applyOgImage(url: string) {
    updateFields({ ...fields, ogImage: url });
    onOpenChange(false);
  }

  function handleConfirmPick() {
    if (!selected) return;
    applyOgImage(selected.url);
  }

  async function handleConfirmGenerate() {
    if (!previewBlob || !draftId) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadOgImage(draftId, previewBlob);
      applyOgImage(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  const onStep2 = mode === "generate" && step === 2;
  const stage: OgStage = onStep2 ? "preview" : mode;
  const { title, description } = STAGE_COPY[stage];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {onStep2 ? (
          <div className="flex aspect-[1200/630] w-full items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
            {genStatus === "loading" && (
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                生成中...（首次較慢，需下載字型）
              </div>
            )}
            {genStatus === "ready" && previewUrl && (
              <img src={previewUrl} alt="OG 預覽" className="h-full w-full object-contain" />
            )}
            {genStatus === "error" && (
              <p className="px-4 text-center text-sm text-red-500 dark:text-red-400">
                生成失敗：{error}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
              {selected ? (
                <img
                  src={selected.url}
                  alt={selected.key}
                  className="h-full w-full object-contain"
                />
              ) : (
                <p className="text-sm text-muted-foreground">尚未選擇圖片</p>
              )}
            </div>
            <ImageLibrary active={open} selectedKey={selected?.key} onPick={setSelected} />
          </>
        )}

        <DialogFooter>
          {onStep2 ? (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={uploading}>
                上一步
              </Button>
              <Button
                onClick={handleConfirmGenerate}
                disabled={genStatus !== "ready" || uploading}
              >
                {uploading ? "上傳中..." : "上傳並套用"}
              </Button>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
              {mode === "generate" ? (
                <Button onClick={() => setStep(2)} disabled={!selected}>
                  下一步
                </Button>
              ) : (
                <Button onClick={handleConfirmPick} disabled={!selected}>
                  選擇
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
