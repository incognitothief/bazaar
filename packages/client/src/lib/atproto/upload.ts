import type { ATPRepoClient } from "./session";

export async function uploadBlob(
  agent: ATPRepoClient,
  file: File,
): Promise<string> {
  const res = await agent.uploadBlob(file, {
    headers: file.type ? { "Content-Type": file.type } : undefined,
  });
  const ref = res.data.blob.ref;
  return typeof ref === "string" ? ref : String(ref);
}
