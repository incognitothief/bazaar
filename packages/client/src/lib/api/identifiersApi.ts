import { browserApiUrl } from "@/lib/browserApi";

export type BazaarIdentifierDto = {
  id: string;
  sig: string;
  generatedAt: string;
};

async function identifiersPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(browserApiUrl(`/api/identifiers${path}`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export async function postIdentifierRid(params: {
  artistDid: string;
  fileCid: string;
  fileChecksum: string;
  createdAt: string;
}): Promise<{ bazaarRid: BazaarIdentifierDto }> {
  return identifiersPost("/rid", params as unknown as Record<string, unknown>);
}

export async function postIdentifierWid(params: {
  artistDid: string;
  compositionTitle: string;
  writers: Array<{ name?: string; ipi?: string; did?: string }>;
  createdAt: string;
}): Promise<{ bazaarWid: BazaarIdentifierDto }> {
  return identifiersPost("/wid", params as unknown as Record<string, unknown>);
}

export async function postIdentifierPid(params: {
  artistDid: string;
  collectionUri: string;
  releaseDate: string;
}): Promise<{ bazaarPid: BazaarIdentifierDto }> {
  return identifiersPost("/pid", params as unknown as Record<string, unknown>);
}
