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
  source: "indexed";
};

export type DeletionBlocker = {
  kind: "listing";
  uri: string;
  status: string;
  targetUri: string;
};

export type DeletionManifest = {
  entryUri: string;
  entryKind: "product" | "item";
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

/**
 * Server error codes rendered for the merchant.
 *
 * The codes themselves are written for logs; these are what the dialog shows.
 * Each one has to answer two questions the merchant actually has: what state
 * is my data in, and should I try again.
 *
 * Be careful editing these -- the difference between "nothing was deleted" and
 * "some of it was" is load-bearing, not a tone choice. Only the aborts before
 * step 3 of executeDeletion leave everything intact; record_delete_failed does
 * not (see ADR 0017 for the ordering).
 */
const DELETE_ERROR_MESSAGES: Record<string, string> = {
  // --- refusals: nothing touched ---
  blocked_by_listings:
    "This entry is still listed for sale. Remove its listings first, then delete it.",
  confirmation_mismatch:
    "That name doesn't match. Type the entry's title exactly as shown above.",
  not_owner: "That entry isn't part of your store.",
  not_found: "That entry no longer exists — it may already have been deleted.",
  invalid_entry_uri: "That isn't a valid catalog entry.",
  invalid_body:
    "Something went wrong sending the request. Reload the page and try again.",
  unauthorized: "Your session expired. Sign in again to delete inventory.",
  forbidden: "Only the store owner can delete inventory.",

  // --- aborted before anything was removed ---
  r2_unconfigured:
    "File storage isn't configured, so nothing can be erased. Nothing was deleted.",
  r2_delete_failed:
    "Couldn't erase this entry's files from storage. Nothing else was deleted and your records are untouched — try again.",
  r2_verify_failed:
    "Couldn't confirm the files were erased, so the delete was stopped before removing anything else. Your records are untouched — try again.",
  r2_delete_incomplete:
    "Storage reported the files as deleted but they're still there. This is usually a permissions or bucket problem. Your records are untouched — nothing else was removed.",

  // --- partial: bytes are already gone, records are not ---
  record_delete_failed:
    "The files were erased, but some records couldn't be removed. Run the delete again to finish clearing them.",

  server_misconfigured:
    "This store isn't fully configured. Check the server settings.",
};

/** Human message for a server error code, falling back to the raw code. */
export function deleteErrorMessage(code: string): string {
  return DELETE_ERROR_MESSAGES[code] ?? code;
}

async function merchantPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(browserApiUrl(`/api/merchant${path}`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text();
    let code = "";
    try {
      code = JSON.parse(raw)?.error ?? "";
    } catch {
      /* non-JSON error body */
    }
    // Unmapped codes fall through as-is rather than being swallowed by a
    // generic message -- an unrecognised code should still be reportable.
    throw new Error(
      code ? deleteErrorMessage(code) : raw || `Request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

/** Enumerate what deleting `uri` would destroy. Destroys nothing. */
export async function fetchDeletionManifest(
  uri: string,
): Promise<DeletionManifest> {
  return merchantPost<DeletionManifest>("/catalog/entry/delete-manifest", {
    uri,
  });
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
  return merchantPost<DeletionOutcome>("/catalog/entry/delete", {
    uri,
    confirm,
  });
}
