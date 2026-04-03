import type { Agent } from "@atproto/api";

export async function fetchBlobObjectUrl(
  agent: Agent,
  did: string,
  cid: string,
): Promise<string | null> {
  try {
    const res = await agent.com.atproto.sync.getBlob({ did, cid });
    const ct =
      res.headers?.["content-type"] ??
      res.headers?.["Content-Type"] ??
      "application/octet-stream";
    const blob = new Blob([res.data as BlobPart], { type: ct });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
