import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "../ui/button";
import { fetchImages, syncImages, uploadImage, type ImageItem } from "../../lib/api/images";

interface ImageLibraryProps {
  /** 通常綁定 dialog 的 open 狀態：false→true 時載入圖片清單。 */
  active: boolean;
  /** 已選定圖片的 key，會在格線上加高亮邊框。 */
  selectedKey?: string | null;
  /** 點選任一張圖片時呼叫。 */
  onPick: (img: ImageItem) => void;
}

/**
 * 可複用的圖片庫內容：含「從 R2 同步」「上傳圖片」工具列與圖片格線。
 *
 * @remarks
 * 自行管理圖片清單與同步／上傳狀態；`active` 由 false→true 時才載入清單，
 * 通常綁定外層 dialog 的 open 狀態，避免關閉狀態下發出請求。
 */
export default function ImageLibrary({ active, selectedKey, onPick }: ImageLibraryProps) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    setError(null);
    setLoading(true);
    fetchImages()
      .then(setImages)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [active]);

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

  return (
    <div className="flex flex-col gap-3">
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

      <div className="max-h-[40vh] min-h-[8rem] overflow-auto">
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
                onClick={() => onPick(img)}
                title={img.key}
                className={`relative aspect-square overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 transition-all hover:ring-2 hover:ring-primary ${
                  img.key === selectedKey ? "ring-2 ring-primary" : ""
                }`}
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
    </div>
  );
}
