import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

export function ImageDropzone({
  onFile,
  onError,
  aspectRatio = "1:1",
  maxSizeMb = 10,
}: {
  onFile: (file: File, previewUrl: string) => void;
  onError: (msg: string) => void;
  aspectRatio?: "1:1" | "16:9";
  maxSizeMb?: number;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  const handle = useCallback(
    (file: File) => {
      const maxBytes = maxSizeMb * 1024 * 1024;
      if (file.size > maxBytes) {
        onError(`Image too large (max ${maxSizeMb} MB)`);
        return;
      }
      if (!file.type.startsWith("image/")) {
        onError("Please use JPEG, PNG, or WebP.");
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (aspectRatio === "1:1" && (img.width < 600 || img.height < 600)) {
          URL.revokeObjectURL(url);
          onError("Minimum dimensions 600×600 for square artwork.");
          return;
        }
        setPreview(url);
        onFile(file, url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        onError("Could not read image.");
      };
      img.src = url;
    },
    [aspectRatio, maxSizeMb, onFile, onError],
  );

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-dashed border-border p-4",
        aspectRatio === "1:1" ? "max-w-sm" : "max-w-lg",
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) handle(f);
      }}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        id="image-drop"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      <label htmlFor="image-drop" className="cursor-pointer block text-sm">
        {preview ? (
          <img
            src={preview}
            alt="Preview"
            className={cn(
              "w-full rounded-md object-cover",
              aspectRatio === "1:1" ? "aspect-square" : "aspect-video",
            )}
          />
        ) : (
          <span className="text-muted-foreground">Drop artwork or browse</span>
        )}
      </label>
    </div>
  );
}
