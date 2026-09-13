import { useCallback, useState } from "react";
import { parseAudioFile, type ParsedAudioMeta } from "@/lib/audio/parse";
import { cn } from "@/lib/utils";

const DEFAULT_ACCEPT = [
  "audio/flac",
  "audio/wav",
  "audio/mpeg",
  "audio/aac",
  "audio/ogg",
];

function maxSizeLabel(maxSizeMb: number): string {
  return maxSizeMb >= 1024 && maxSizeMb % 1024 === 0
    ? `${maxSizeMb / 1024} GB`
    : `${maxSizeMb} MB`;
}

export function AudioFileDropzone({
  onFile,
  onError,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 50 * 1024,
}: {
  onFile: (file: File, meta: ParsedAudioMeta) => void;
  onError: (msg: string) => void;
  accept?: string[];
  maxSizeMb?: number;
}) {
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    async (file: File) => {
      const maxBytes = maxSizeMb * 1024 * 1024;
      if (file.size > maxBytes) {
        onError(`File too large (max ${maxSizeLabel(maxSizeMb)})`);
        return;
      }
      const okMime = !file.type || accept.some((a) => file.type === a);
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const okExt = ["flac", "wav", "mp3", "aac", "ogg", "m4a", "opus"].includes(
        ext,
      );
      if (!okMime && !okExt) {
        onError("Unsupported format. Try FLAC, WAV, MP3, AAC, or OGG.");
        return;
      }
      setBusy(true);
      try {
        const meta = await parseAudioFile(file);
        onFile(file, meta);
      } catch {
        onError("Could not read audio metadata.");
      } finally {
        setBusy(false);
      }
    },
    [accept, maxSizeMb, onFile, onError],
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
        const f = e.dataTransfer.files[0];
        if (f) void handle(f);
      }}
    >
      <input
        type="file"
        accept={accept.join(",")}
        className="sr-only"
        id="audio-drop"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
        }}
      />
      <label
        htmlFor="audio-drop"
        className="cursor-pointer text-sm text-muted-foreground"
      >
        <span className="font-medium text-foreground">Drop audio here</span> or{" "}
        browse
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Large files over 100MB may take a moment to parse.
      </p>
      {busy ? <p className="mt-2 text-xs">Parsing…</p> : null}
    </div>
  );
}
