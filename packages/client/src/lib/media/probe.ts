/**
 * Best-effort media introspection in the browser -- no dependencies, no server
 * load. Values feed the publish draft and are mirrored ERP-only (never on the
 * PDS record), same lifecycle as the audio duration parsed by lib/audio/parse.
 *
 * Every function resolves to null rather than throwing: a format the browser
 * can't decode (mkv/avi video, SVG) or a corrupt file just yields no metadata,
 * and the upload proceeds normally.
 */

const PROBE_TIMEOUT_MS = 15_000;

/** Runtime in milliseconds for a video file, via a detached <video> element. */
export async function probeVideoDuration(file: File): Promise<number | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.preload = "metadata";
  el.muted = true;

  try {
    const seconds = await new Promise<number | null>((resolve) => {
      const done = (v: number | null) => {
        el.removeAttribute("src");
        el.load();
        resolve(v);
      };
      const timer = window.setTimeout(() => done(null), PROBE_TIMEOUT_MS);
      el.onloadedmetadata = () => {
        window.clearTimeout(timer);
        const d = el.duration;
        done(Number.isFinite(d) && d > 0 ? d : null);
      };
      el.onerror = () => {
        window.clearTimeout(timer);
        done(null);
      };
      el.src = url;
    });
    return seconds == null ? null : Math.round(seconds * 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pixel dimensions for a raster image file. Null for vector art or non-images. */
export async function probeImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      /* fall through to the <img> path */
    }
  }

  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    return await new Promise<{ width: number; height: number } | null>(
      (resolve) => {
        const timer = window.setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
        img.onload = () => {
          window.clearTimeout(timer);
          resolve(
            img.naturalWidth > 0 && img.naturalHeight > 0
              ? { width: img.naturalWidth, height: img.naturalHeight }
              : null,
          );
        };
        img.onerror = () => {
          window.clearTimeout(timer);
          resolve(null);
        };
        img.src = url;
      },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
