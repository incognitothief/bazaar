import { useCallback, useId, useState } from "react";
import { cn } from "@/lib/utils";

export type BatchFileEntry = {
  id: string;
  file: File;
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generic sibling of BatchAudioFileDropzone -- that one parses audio
 * metadata and only accepts audio MIME types/extensions, which doesn't fit
 * catalog.item's fully generic shape (a PDF ebook, an asset zip, an image
 * are all valid items now, not just audio).
 */
export function BatchFileDropzone({
  onBatch,
  onError,
  maxSizeMb = 500,
  hint,
}: {
  onBatch: (entries: BatchFileEntry[]) => void;
  onError: (msg: string) => void;
  maxSizeMb?: number;
  hint?: string;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      setBusy(true);
      try {
        const maxBytes = maxSizeMb * 1024 * 1024;
        const next: BatchFileEntry[] = [];
        for (const file of files) {
          if (file.size > maxBytes) {
            onError(`"${file.name}" is too large (max ${maxSizeMb} MB)`);
            continue;
          }
          next.push({ id: makeId(), file });
        }
        if (next.length) onBatch(next);
      } finally {
        setBusy(false);
      }
    },
    [maxSizeMb, onBatch, onError],
  );

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors",
        "hover:bg-muted/40 focus-within:border-ring",
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        multiple
        className="sr-only"
        id={inputId}
        disabled={busy}
        onChange={(e) => {
          const fl = e.target.files;
          if (fl?.length) {
            handleFiles(fl);
            e.target.value = "";
          }
        }}
      />
      <label htmlFor={inputId} className="cursor-pointer text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Drop one or more files</span> or
        browse
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        {hint ?? "Each file becomes an item in this product."}
      </p>
    </div>
  );
}
