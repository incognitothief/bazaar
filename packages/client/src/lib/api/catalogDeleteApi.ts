import { browserApiUrl } from "@/lib/browserApi";

export type PdsRecordRef = {
  uri: string;
  collection: string;
  rkey: string;
  label: string;
};

export type R2ObjectRef = {
  key: string;
  label: string;
  source: "indexed" | "recomputed";
};

export type DeletionBlocker = { kind: "listing"; uri: string; detail: string };

export type DeletionManifest = {
  entryUri: string;
  entryKind: "product" | "legacy";
  title: string;
  blockers: DeletionBlocker[];
  pdsRecords: PdsRecordRef[];
  r2Objects: R2ObjectRef[];
  objectIds: string[];
  sharedItemsSkipped: { uri: string; reason: string }[];
  receiptCount: number;
};

export type DeletionOutcome = {
  ok: true;
  deletedObjects: string[];
  deletedRecords: string[];
  alreadyGone: string[];
  manifest: DeletionManifest;
};

async function merchantPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(browserApiUrl(`/api/merchant${path}`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      detail = parsed.error ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Enumerate what deleting `uri` would destroy. Destroys nothing. */
export async function fetchDeletionManifest(uri: string): Promise<DeletionManifest> {
  return merchantPost<DeletionManifest>("/catalog/entry/delete-manifest", { uri });
}

/**
 * Permanently delete a catalog entry. `confirm` must equal the entry's exact
 * title; the server rebuilds and re-checks the manifest regardless of what the
 * dialog was showing.
 */
export async function deleteCatalogEntry(
  uri: string,
  confirm: string,
): Promise<DeletionOutcome> {
  return merchantPost<DeletionOutcome>("/catalog/entry/delete", { uri, confirm });
}
