import { browserApiUrl } from "@/lib/browserApi";

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

export async function createInventorySession(inventoryKind = "digital"): Promise<{
  sessionId: string;
}> {
  const res = await invFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ inventoryKind }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ sessionId: string }>;
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
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
}

export type PublishInventorySnapshot = {
  items: Array<{ uri: string; cid: string; rkey: string }>;
  primaryItemUri: string;
};

export async function publishInventorySession(
  sessionId: string,
): Promise<PublishInventorySnapshot> {
  const res = await invFetch(`/sessions/${sessionId}/publish`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<PublishInventorySnapshot>;
}

export type InventoryPrefillPayload = {
  v: number;
  primaryItemUri: string;
  collectionUri: string;
  licenseUri: string;
  licenseGrantCid: string;
  priceUsd?: string;
  individualPurchaseTrackUris?: string[];
};

export async function fetchLatestInventoryPrefill(): Promise<{
  prefill: InventoryPrefillPayload | null;
  id?: string;
  createdAt?: string | null;
}> {
  const res = await invFetch("/prefill/latest");
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    prefill: InventoryPrefillPayload | null;
    id?: string;
    createdAt?: string | null;
  }>;
}

const MULTIPART_CHUNK = 8 * 1024 * 1024;

/** Bytes delivered for the current file (`total` = file.size). */
export type InventoryUploadProgressEvent = {
  loaded: number;
  total: number;
};

export async function uploadFileToInventoryObject(
  objectId: string,
  file: File,
  uploadKind: string,
  onProgress?: (e: InventoryUploadProgressEvent) => void,
): Promise<void> {
  const total = file.size;
  if (uploadKind === "single_put") {
    onProgress?.({ loaded: 0, total });
    await uploadInventorySingle(objectId, file);
    onProgress?.({ loaded: total, total });
    return;
  }
  await multipartInit(objectId);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let partNumber = 1;
  /** Presigned PUT to R2 first (lower latency); switch to API proxy if CORS/network fails. */
  let preferDirectR2 = true;
  let loaded = 0;
  onProgress?.({ loaded, total });
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
    onProgress?.({ loaded: Math.min(loaded, total), total });
  }
  if (parts.length === 0) throw new Error("empty file");
  const last = file.size % MULTIPART_CHUNK;
  if (file.size > MULTIPART_CHUNK && last > 0 && last < 5 * 1024 * 1024 && parts.length > 1) {
    /* R2/S3: all but last part must be ≥5MB except last. Our 8MB chunks satisfy except when
       final chunk is small — allowed as last part. */
  }
  await multipartComplete(objectId, parts);
  onProgress?.({ loaded: total, total });
}
