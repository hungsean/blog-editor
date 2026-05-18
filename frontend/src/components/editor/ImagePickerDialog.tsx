import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import ImageLibrary from "./ImageLibrary";
import type { ImageItem } from "../../lib/api/images";

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
 * 點選任一張圖片會立即呼叫 `onSelect` 並關閉對話框。
 */
export default function ImagePickerDialog({ open, onOpenChange, onSelect }: ImagePickerDialogProps) {
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

        <ImageLibrary active={open} onPick={handlePick} />
      </DialogContent>
    </Dialog>
  );
}
