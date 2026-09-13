/**
 * Live "zipping item N of M" state for an in-flight product zip rebuild,
 * so the merchant UI can show real per-item progress instead of just an
 * elapsed-time counter. In-memory and per-process by design -- this app is
 * one Bun process, one machine (see productZip.ts, r2/inventoryKey.ts), so
 * there's no cross-process state to reconcile. Entries are inherently
 * ephemeral: a stale one just means the client polls until the next
 * rebuild overwrites or clears it, and a process restart clears the map.
 * Durable "this job was running" lives on catalogProducts.packageZipRebuildStartedAt.
 */
type ZipProgress = {
  current: number;
  total: number;
  fileName: string;
  /** Raw source bytes read so far (not compressed zip output). */
  bytesRead: number;
  /** Sum of completed objects' byteSize; 0 if unknown. */
  bytesTotal: number;
  /** First setZipProgress for this URI; preserved across later updates. */
  startedAt: number;
  updatedAt: number;
};

const progress = new Map<string, ZipProgress>();

export function setZipProgress(
  productUri: string,
  p: Omit<ZipProgress, "updatedAt" | "startedAt">,
): void {
  const prev = progress.get(productUri);
  const now = Date.now();
  progress.set(productUri, {
    ...p,
    startedAt: prev?.startedAt ?? now,
    updatedAt: now,
  });
}

export function clearZipProgress(productUri: string): void {
  progress.delete(productUri);
}

export function getZipProgress(productUri: string): ZipProgress | null {
  return progress.get(productUri) ?? null;
}

/** Every in-flight rebuild in this process. Empty after a crash — durable failure is packageZipStatus / packageZipRebuildStartedAt, not this map. */
export function listZipProgress(): Array<{ productUri: string } & ZipProgress> {
  return [...progress.entries()].map(([productUri, p]) => ({ productUri, ...p }));
}
