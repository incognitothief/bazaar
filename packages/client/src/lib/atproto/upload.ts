import type { Agent } from "@atproto/api";

export async function uploadBlob(
  agent: Agent,
  file: File,
): Promise<string> {
  const res = await agent.uploadBlob(file, {
    headers: file.type ? { "Content-Type": file.type } : undefined,
  });
  const ref = res.data.blob.ref;
  return typeof ref === "string" ? ref : ref.toString();
}
