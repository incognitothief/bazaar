import type { SimpleStore } from "@atproto-labs/simple-store";
import { JoseKey } from "@atproto/jwk-jose";
import {
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  requestLocalLock,
} from "@atproto/oauth-client-node";

function memoryStore<K extends string, V>(): SimpleStore<K, V> {
  const m = new Map<K, V>();
  return {
    get: async (key) => m.get(key),
    set: async (key, val) => {
      m.set(key, val);
    },
    del: async (key) => {
      m.delete(key);
    },
  };
}

/** OAuth state (short-lived); cleared after callback. */
export const oauthStateStore = memoryStore<string, NodeSavedState>();

/** Persisted OAuth sessions by DID (restart clears — use DB in production). */
export const oauthSessionStore = memoryStore<string, NodeSavedSession>();

let clientPromise: Promise<NodeOAuthClient> | null = null;

/**
 * Where the Bun API listens (browser callback). Use 127.0.0.1, not "localhost"
 * — ATProto redirect URI schema rejects http://localhost.
 */
export function getApiListenBase(): string {
  const raw = process.env.BAZAAR_API_ORIGIN?.trim();
  if (raw) return raw.replace(/\/$/, "");
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

/** OAuth callback URL registered in client metadata and sent to the issuer. */
export function getOAuthRedirectUri(): string {
  const ex = process.env.ATPROTO_OAUTH_REDIRECT_URI?.trim();
  if (ex) return ex;
  return `${getApiListenBase()}/api/atproto/callback`;
}

/**
 * Public https base for client_id + jwks_uri (no trailing slash).
 * Bluesky must fetch this from the internet — use a tunnel in dev.
 */
export function getOAuthMetadataBase(): string {
  const raw =
    process.env.BAZAAR_OAUTH_METADATA_ORIGIN?.trim() ||
    process.env.BAZAAR_PUBLIC_ORIGIN?.trim();
  if (!raw) {
    throw new Error(
      "Set BAZAAR_OAUTH_METADATA_ORIGIN to an https:// URL where this API is reachable publicly (e.g. https://xxxx.trycloudflare.com from `cloudflared tunnel --url http://127.0.0.1:3000`). Plain http://localhost cannot be used as client_id.",
    );
  }
  return raw.replace(/\/$/, "");
}

function assertDiscoverableClientIdBase(origin: string): void {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new Error(`Invalid OAuth metadata origin: ${origin}`);
  }
  if (u.protocol !== "https:") {
    throw new Error(
      `BAZAAR_OAUTH_METADATA_ORIGIN must use https:// (@atproto/oauth-types requires discoverable client_id to be HTTPS). Got: ${origin}`,
    );
  }
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") {
    throw new Error(
      "client_id cannot use a loopback hostname with https. Use a tunnel DNS name (e.g. *.trycloudflare.com, *.ngrok-free.app).",
    );
  }
  if (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) ||
    h.includes(":") /* rough IPv6 */
  ) {
    throw new Error(
      "client_id hostname cannot be a numeric IP. Use a DNS name from your HTTPS tunnel.",
    );
  }
  if (!h.includes(".")) {
    throw new Error(
      "client_id hostname must look like a real domain (contain a dot), e.g. api.example.com or xxxx.trycloudflare.com.",
    );
  }
}

function assertRedirectUriForAtProto(redirect: string): void {
  if (redirect.startsWith("http://localhost")) {
    throw new Error(
      'Redirect URI must not use hostname "localhost" (ATProto schema). Use http://127.0.0.1 with BAZAAR_API_ORIGIN or ATPROTO_OAUTH_REDIRECT_URI.',
    );
  }
}

function oauthAllowHttp(): boolean {
  return (
    getOAuthRedirectUri().startsWith("http://") ||
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Loads ES256 client signing key for private_key_jwt.
 * Set `ATPROTO_OAUTH_PRIVATE_KEY_JWK` to a full private JWK JSON (e.g. from scripts/generate-oauth-jwk.mjs).
 */
async function loadClientSigningKey(): Promise<JoseKey> {
  const jwk = process.env.ATPROTO_OAUTH_PRIVATE_KEY_JWK?.trim();
  if (!jwk) {
    throw new Error(
      "Set ATPROTO_OAUTH_PRIVATE_KEY_JWK (JSON) — run: npm run oauth:jwk -w @bazaar/server",
    );
  }
  return JoseKey.fromImportable(jwk);
}

export async function getNodeOAuthClient(): Promise<NodeOAuthClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const metadataBase = getOAuthMetadataBase();
      assertDiscoverableClientIdBase(metadataBase);
      const redirectUri = getOAuthRedirectUri();
      assertRedirectUriForAtProto(redirectUri);

      const key = await loadClientSigningKey();
      const clientUri =
        process.env.APP_URL?.replace(/\/$/, "") || metadataBase;

      const clientMetadata = {
        client_id: `${metadataBase}/api/atproto/oauth/client-metadata.json`,
        client_name: "Bazaar",
        client_uri: clientUri,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"] as const,
        scope: "atproto transition:generic",
        response_types: ["code"] as const,
        application_type: "web" as const,
        token_endpoint_auth_method: "private_key_jwt" as const,
        token_endpoint_auth_signing_alg: "ES256",
        dpop_bound_access_tokens: true,
        jwks_uri: `${metadataBase}/api/atproto/oauth/jwks.json`,
      };

      return new NodeOAuthClient({
        clientMetadata,
        keyset: [key],
        stateStore: oauthStateStore,
        sessionStore: oauthSessionStore,
        requestLock: requestLocalLock,
        allowHttp: oauthAllowHttp(),
      });
    })();
  }
  return clientPromise;
}

export async function getStoredTokenSet(did: string) {
  const row = await oauthSessionStore.get(did);
  return row?.tokenSet;
}
