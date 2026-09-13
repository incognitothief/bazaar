/**
 * Live "zipping item N of M" state for an in-flight product zip rebuild,
 * so the merchant UI can show real per-item progress instead of just an
 * elapsed-time counter. In-memory and per-process by design -- this app is
 * one Bun process, one machine (see productZip.ts, r2/inventoryKey.ts), so
 * there's no cross-process state to reconcile. Entries are inherently
 * ephemeral: a stale one just means the client polls until the next
 * rebuild overwrites or clears it, and a process restart clears the map
 * entirely with no persistence needed.
 */
type ZipProgress = {
  current: number;
  total: number;
  fileName: string;
  updatedAt: number;
};

const progress = new Map<string, ZipProgress>();

export function setZipProgress(
  productUri: string,
  p: Omit<ZipProgress, "updatedAt">,
): void {
  progress.set(productUri, { ...p, updatedAt: Date.now() });
}

export function clearZipProgress(productUri: string): void {
  progress.delete(productUri);
}

export function getZipProgress(productUri: string): ZipProgress | null {
  return progress.get(productUri) ?? null;
}
