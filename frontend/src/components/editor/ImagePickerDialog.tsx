import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { fetchImages, syncImages, uploadImage, type ImageItem } from "../../lib/api/images";

interface ImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 使用者選定一張圖片時呼叫，參數為圖片公開 URL。 */
  onSelect: (url: string) => void;
}

/**
 * 圖片庫挑選對話框。
 *
 * 開啟時讀取本地圖片庫；提供「從 R2 同步」與「上傳圖片」兩個動作。
 * 點選任一張圖片會呼叫 `onSelect` 並關閉對話框。
 */
export default function ImagePickerDialog({ open, onOpenChange, onSelect }: ImagePickerDialogProps) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    fetchImages()
      .then(setImages)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await syncImages();
      setImages(await fetchImages());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const img = await uploadImage(file);
      setImages((prev) => [img, ...prev.filter((p) => p.key !== img.key)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function handlePick(img: ImageItem) {
    onSelect(img.url);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>圖片庫</DialogTitle>
          <DialogDescription>
            選擇一張圖片插入編輯器游標處，或上傳新圖片到 R2。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || uploading}>
            {syncing ? "同步中..." : "從 R2 同步"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || syncing}
          >
            {uploading ? "上傳中..." : "上傳圖片"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
        </div>

        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

        <div className="max-h-[50vh] min-h-[8rem] overflow-auto">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">載入中...</p>
          ) : images.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              圖片庫是空的，按「從 R2 同步」匯入既有圖片，或直接上傳一張。
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((img) => (
                <button
                  key={img.key}
                  type="button"
                  onClick={() => handlePick(img)}
                  title={img.key}
                  className="relative aspect-square overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 transition-all hover:ring-2 hover:ring-primary"
                >
                  <img
                    src={img.url}
                    alt={img.key}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
