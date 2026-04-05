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

export async function publishInventorySession(sessionId: string): Promise<unknown> {
  const res = await invFetch(`/sessions/${sessionId}/publish`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const MULTIPART_CHUNK = 8 * 1024 * 1024;

export async function uploadFileToInventoryObject(
  objectId: string,
  file: File,
  uploadKind: string,
): Promise<void> {
  if (uploadKind === "single_put") {
    await uploadInventorySingle(objectId, file);
    return;
  }
  await multipartInit(objectId);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let partNumber = 1;
  for (let offset = 0; offset < file.size; offset += MULTIPART_CHUNK) {
    const chunk = file.slice(offset, Math.min(offset + MULTIPART_CHUNK, file.size));
    const buf = await chunk.arrayBuffer();
    const { url } = await multipartPartUrl(objectId, partNumber);
    const put = await fetch(url, {
      method: "PUT",
      body: buf,
    });
    if (!put.ok) throw new Error(`Part ${partNumber} upload failed`);
    const etag = put.headers.get("ETag")?.replaceAll('"', "") ?? "";
    if (!etag) throw new Error(`Missing ETag for part ${partNumber}`);
    parts.push({ partNumber, etag });
    partNumber += 1;
  }
  if (parts.length === 0) throw new Error("empty file");
  const last = file.size % MULTIPART_CHUNK;
  if (file.size > MULTIPART_CHUNK && last > 0 && last < 5 * 1024 * 1024 && parts.length > 1) {
    /* R2/S3: all but last part must be ≥5MB except last. Our 8MB chunks satisfy except when
       final chunk is small — allowed as last part. */
  }
  await multipartComplete(objectId, parts);
}
