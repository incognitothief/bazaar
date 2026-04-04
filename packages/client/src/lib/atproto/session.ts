import { Agent } from "@atproto/api";
import { browserApiUrl } from "@/lib/browserApi";

export function createPublicAgent(): Agent {
  return new Agent({ service: import.meta.env.VITE_ATPROTO_SERVICE });
}

/**
 * Minimal interface for ATProto repo operations.
 *
 * The real `@atproto/api` Agent satisfies this structurally, as does the
 * proxy agent below.  Records functions accept this type so they work with
 * both direct credential sessions (dev mock) and server-proxied DPoP sessions.
 */
export interface ATPRepoClient {
  readonly session?: { readonly did: string } | null;
  com: {
    atproto: {
      repo: {
        createRecord(input: {
          repo: string;
          collection: string;
          record: Record<string, unknown>;
        }): Promise<{ data: { uri: string; cid: string } }>;
        putRecord(input: {
          repo: string;
          collection: string;
          rkey: string;
          record: Record<string, unknown>;
          swapRecord?: string;
        }): Promise<unknown>;
        deleteRecord(input: {
          repo: string;
          collection: string;
          rkey: string;
        }): Promise<unknown>;
        // Return types are widened so `Agent` from @atproto/api (XRPC `Response`)
        // remains assignable alongside the in-process proxy implementation.
        getRecord(input: {
          repo: string;
          collection: string;
          rkey: string;
        }): Promise<unknown>;
        listRecords(input: {
          repo: string;
          collection: string;
          limit?: number;
        }): Promise<unknown>;
      };
    };
  };
  uploadBlob(
    blob: Blob,
    opts?: { headers?: Record<string, string> },
  ): Promise<{ data: { blob: { ref: unknown } } }>;
}

/**
 * Creates a proxy agent that routes authenticated write operations through the
 * server (which holds the DPoP keypair) and serves read operations directly
 * from the public ATProto endpoint.
 */
export function createProxyAgent(did: string): ATPRepoClient {
  const publicAgent = createPublicAgent();

  async function proxyPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(browserApiUrl(`/api/atproto${path}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  }

  return {
    session: { did },
    com: {
      atproto: {
        repo: {
          async createRecord(input) {
            const raw = await proxyPost<{ uri: string; cid: string }>(
              "/repo/createRecord",
              { collection: input.collection, record: input.record },
            );
            return { data: raw };
          },
          async putRecord(input) {
            return proxyPost("/repo/putRecord", {
              collection: input.collection,
              rkey: input.rkey,
              record: input.record,
              swapRecord: input.swapRecord,
            });
          },
          async deleteRecord(input) {
            return proxyPost("/repo/deleteRecord", {
              collection: input.collection,
              rkey: input.rkey,
            });
          },
          // Reads are public — no auth needed, go directly to ATProto
          getRecord: (input) =>
            publicAgent.com.atproto.repo.getRecord(input) as Promise<unknown>,
          listRecords: (input) =>
            publicAgent.com.atproto.repo.listRecords(input) as Promise<unknown>,
        },
      },
    },
    async uploadBlob(blob) {
      const formData = new FormData();
      formData.append(
        "file",
        blob instanceof File ? blob : new File([blob], "upload"),
      );
      const res = await fetch(browserApiUrl("/api/atproto/blob"), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg);
      }
      const { cid } = (await res.json()) as { cid: string };
      // Return in the shape expected by upload.ts: res.data.blob.ref
      return { data: { blob: { ref: cid } } };
    },
  };
}
