import { contentClassCopy, resolveContentClass } from "@/lib/itemContentClass";
import { formatBytes } from "@/lib/utils";

export function formatRuntime(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

type FileMeta = {
  category?: string | null;
  format?: string | null;
  durationMs?: number | null;
  byteSize?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
};

/**
 * Compact metadata label, same priority the storefront uses: runtime for
 * audio/video, pixel size for images, file size otherwise — then the preset
 * content-class label (Audio / Document / Bundle / …) as a last resort.
 * Never the raw file extension.
 */
export function itemMetaLabel(m: FileMeta | undefined | null): string | null {
  if (!m) return null;
  const cls = resolveContentClass({ category: m.category, format: m.format });
  if ((cls === "audio" || cls === "video") && m.durationMs) {
    return formatRuntime(m.durationMs);
  }
  if (cls === "graphic" && m.mediaWidth && m.mediaHeight) {
    return `${m.mediaWidth} × ${m.mediaHeight}`;
  }
  if (m.byteSize) return formatBytes(m.byteSize);
  return contentClassCopy(cls).label;
}

export function isAudioMeta(m: FileMeta | undefined | null): boolean {
  return (
    !m ||
    resolveContentClass({ category: m.category, format: m.format }) === "audio"
  );
}
