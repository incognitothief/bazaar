import { browserApiUrl } from "@/lib/browserApi";

function looksLikeHtml(s: string): boolean {
  const t = s.trimStart().slice(0, 64).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

/**
 * Human-readable, non-empty message for failed inventory HTTP responses
 * (empty Fly/proxy bodies, HTML error pages, JSON `{ error, message }`).
 */
export async function inventoryHttpErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  const status = res.status;
  const statusText = res.statusText || "Error";
  if (text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const j = JSON.parse(trimmed) as Record<string, unknown>;
        const msg = j.message;
        const err = j.error;
        const parts: string[] = [];
        if (typeof err === "string" && err) parts.push(err);
        if (typeof msg === "string" && msg) parts.push(msg);
        if (parts.length) return parts.join(": ");
      } catch {
        /* fall through */
      }
    }
    if (!looksLikeHtml(trimmed) && trimmed.length > 0) {
      return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    }
  }
  let base = `HTTP ${status} ${statusText}`;
  if (status === 502 || status === 503)
    base += " (server error — try again)";
  return base;
}

/** Safe string for toasts / row errors when catching inventory upload failures. */
export function inventoryUserFacingError(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message.trim();
    if (m) return m;
  }
  if (typeof e === "string") {
    const m = e.trim();
    if (m) return m;
  }
  return "Something went wrong";
}

async function invFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(browserApiUrl(`/api/inventory${path}`), {
    credentials: "include",
    ...init,
    headers,
  });
}

/**
 * `existingProductUri`: for "product"-kind sessions adding items/assets to
 * an *already-published* product -- the server keys every R2 object
 * uploaded in this session under that product's own rkey. Omit for a new
 * product (the server mints a fresh rkey instead).
 */
export async function createInventorySession(
  inventoryKind = "product",
  existingProductUri?: string,
): Promise<{
  sessionId: string;
  /** The product's URI, known up front for "product"-kind sessions (minted server-side for a new product, echoed back for an existing one) -- lets the UI poll zip-progress before the publish response comes back. Null for non-product sessions. */
  productUri: string | null;
}> {
  const res = await invFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ inventoryKind, existingProductUri }),
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{ sessionId: string; productUri: string | null }>;
}

export async function registerInventoryObjects(
  sessionId: string,
  objects: Array<{
    slotId: string;
    rkey?: string;
    fileName: string;
    contentType?: string;
    byteSize?: number;
    role: "master" | "artwork";
  }>,
): Promise<{
  objects: Array<{
    objectId: string;
    rkey: string;
    r2Key: string;
    uploadKind: string;
  }>;
}> {
  const res = await invFetch(`/sessions/${sessionId}/objects`, {
    method: "POST",
    body: JSON.stringify({ objects }),
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{
    objects: Array<{
      objectId: string;
      rkey: string;
      r2Key: string;
      uploadKind: string;
    }>;
  }>;
}

export async function uploadInventorySingle(
  objectId: string,
  file: File,
): Promise<{ fileChecksum: string; fileCid: string; fileFormat: string }> {
  const fd = new FormData();
  fd.set("file", file);
  const res = await invFetch(`/objects/${objectId}/upload-single`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{
    fileChecksum: string;
    fileCid: string;
    fileFormat: string;
  }>;
}

export async function multipartInit(objectId: string): Promise<{ uploadId: string }> {
  const res = await invFetch(`/objects/${objectId}/multipart/init`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{ uploadId: string }>;
}

/** Presigned PUT URL for uploading one multipart part directly to R2/S3 (faster when bucket CORS allows the app origin). */
export async function multipartPartUrl(
  objectId: string,
  partNumber: number,
): Promise<{ url: string }> {
  const res = await invFetch(`/objects/${objectId}/multipart/part-url`, {
    method: "POST",
    body: JSON.stringify({ partNumber }),
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{ url: string }>;
}

/** Try browser → R2 presigned PUT; returns ETag or null if blocked (e.g. CORS) or failed. */
async function tryMultipartPartDirectToR2(
  objectId: string,
  partNumber: number,
  buf: ArrayBuffer,
): Promise<string | null> {
  try {
    const { url } = await multipartPartUrl(objectId, partNumber);
    const put = await fetch(url, { method: "PUT", body: buf });
    if (!put.ok) return null;
    const etag = put.headers.get("ETag")?.replaceAll('"', "") ?? "";
    return etag || null;
  } catch {
    return null;
  }
}

export async function multipartUploadPart(
  objectId: string,
  partNumber: number,
  body: ArrayBuffer,
): Promise<{ partNumber: number; etag: string }> {
  const res = await invFetch(`/objects/${objectId}/multipart/upload-part`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Inventory-Part-Number": String(partNumber),
    },
    body,
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{ partNumber: number; etag: string }>;
}

export async function multipartComplete(
  objectId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<{ fileChecksum: string; fileCid: string; fileFormat: string }> {
  const res = await invFetch(`/objects/${objectId}/multipart/complete`, {
    method: "POST",
    body: JSON.stringify({ parts }),
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{
    fileChecksum: string;
    fileCid: string;
    fileFormat: string;
  }>;
}

export async function saveInventoryDraft(sessionId: string, draft: unknown): Promise<void> {
  const res = await invFetch(`/sessions/${sessionId}/draft`, {
    method: "PUT",
    body: JSON.stringify({ draft }),
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
}

export type PublishProductSnapshot = {
  productUri: string;
  productCid: string;
  items: Array<{ uri: string; cid: string }>;
};

/** Publishes a "product" inventoryKind session as catalog.item/catalog.product records. */
export async function publishProductSession(
  sessionId: string,
): Promise<PublishProductSnapshot> {
  const res = await invFetch(`/sessions/${sessionId}/publish-product`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<PublishProductSnapshot>;
}

/** Creates catalog.item records with no product wrapper -- used to add a new item to an existing product. */
export async function publishItemsSession(
  sessionId: string,
): Promise<{ items: Array<{ uri: string; cid: string }> }> {
  const res = await invFetch(`/sessions/${sessionId}/publish-items`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await inventoryHttpErrorMessage(res));
  return res.json() as Promise<{ items: Array<{ uri: string; cid: string }> }>;
}

const MULTIPART_CHUNK = 8 * 1024 * 1024;

/**
 * Bytes delivered for the current file (`total` = file.size).
 * `finalizing` means every byte is already in object storage; the server is
 * still hashing the object so we have a checksum/CID. That pass has no
 * client-side progress and can take a while on multi-GB files.
 */
export type InventoryUploadProgressEvent = {
  loaded: number;
  total: number;
  phase?: "uploading" | "finalizing";
};

export async function uploadFileToInventoryObject(
  objectId: string,
  file: File,
  uploadKind: string,
  onProgress?: (e: InventoryUploadProgressEvent) => void,
): Promise<void> {
  const total = file.size;
  if (uploadKind === "single_put") {
    onProgress?.({ loaded: 0, total, phase: "uploading" });
    await uploadInventorySingle(objectId, file);
    onProgress?.({ loaded: total, total, phase: "uploading" });
    return;
  }
  await multipartInit(objectId);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let partNumber = 1;
  /** Presigned PUT to R2 first (lower latency); switch to API proxy if CORS/network fails. */
  let preferDirectR2 = true;
  let loaded = 0;
  onProgress?.({ loaded, total, phase: "uploading" });
  for (let offset = 0; offset < file.size; offset += MULTIPART_CHUNK) {
    const chunk = file.slice(offset, Math.min(offset + MULTIPART_CHUNK, file.size));
    const buf = await chunk.arrayBuffer();
    let etag: string | null = null;
    if (preferDirectR2) {
      etag = await tryMultipartPartDirectToR2(objectId, partNumber, buf);
      if (!etag) preferDirectR2 = false;
    }
    if (!etag) {
      const out = await multipartUploadPart(objectId, partNumber, buf);
      etag = out.etag;
    }
    parts.push({ partNumber, etag });
    partNumber += 1;
    loaded += buf.byteLength;
    onProgress?.({
      loaded: Math.min(loaded, total),
      total,
      phase: "uploading",
    });
  }
  if (parts.length === 0) throw new Error("empty file");
  const last = file.size % MULTIPART_CHUNK;
  if (file.size > MULTIPART_CHUNK && last > 0 && last < 5 * 1024 * 1024 && parts.length > 1) {
    /* R2/S3: all but last part must be ≥5MB except last. Our 8MB chunks satisfy except when
       final chunk is small — allowed as last part. */
  }
  onProgress?.({ loaded: total, total, phase: "finalizing" });
  await multipartComplete(objectId, parts);
  onProgress?.({ loaded: total, total, phase: "finalizing" });
}
