import { useCallback, useId, useState } from "react";
import { parseAudioFile, type ParsedAudioMeta } from "@/lib/audio/parse";
import { cn } from "@/lib/utils";

const DEFAULT_ACCEPT = [
  "audio/flac",
  "audio/wav",
  "audio/mpeg",
  "audio/aac",
  "audio/ogg",
];

export type BatchAudioEntry = {
  id: string;
  file: File;
  meta: ParsedAudioMeta;
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function BatchAudioFileDropzone({
  onBatch,
  onError,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 500,
}: {
  onBatch: (entries: BatchAudioEntry[]) => void;
  onError: (msg: string) => void;
  accept?: string[];
  maxSizeMb?: number;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      setBusy(true);
      try {
        const maxBytes = maxSizeMb * 1024 * 1024;
        const next: BatchAudioEntry[] = [];
        for (const file of files) {
          if (file.size > maxBytes) {
            onError(`"${file.name}" is too large (max ${maxSizeMb} MB)`);
            continue;
          }
          const okMime = !file.type || accept.some((a) => file.type === a);
          const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
          const okExt = ["flac", "wav", "mp3", "aac", "ogg", "m4a", "opus"].includes(
            ext,
          );
          if (!okMime && !okExt) {
            onError(`Unsupported format: ${file.name}`);
            continue;
          }
          try {
            const meta = await parseAudioFile(file);
            next.push({ id: makeId(), file, meta });
          } catch {
            onError(`Could not read audio metadata: ${file.name}`);
          }
        }
        if (next.length) onBatch(next);
      } finally {
        setBusy(false);
      }
    },
    [accept, maxSizeMb, onBatch, onError],
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
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        multiple
        accept={accept.join(",")}
        className="sr-only"
        id={inputId}
        disabled={busy}
        onChange={(e) => {
          const fl = e.target.files;
          if (fl?.length) {
            void handleFiles(fl);
            e.target.value = "";
          }
        }}
      />
      <label
        htmlFor={inputId}
        className="cursor-pointer text-sm text-muted-foreground"
      >
        <span className="font-medium text-foreground">Drop multiple audio files</span>{" "}
        or browse
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Batch staging for collections. Full publish flow will use these when catalog
        APIs support batch import.
      </p>
      {busy ? <p className="mt-2 text-xs">Parsing…</p> : null}
    </div>
  );
}
