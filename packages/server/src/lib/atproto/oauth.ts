import {
  buildAtprotoLoopbackClientMetadata,
  requestLocalLock,
} from "@atproto/oauth-client";
import { NodeOAuthClient, JoseKey } from "@atproto/oauth-client-node";
import type { NodeSavedSession, NodeSavedState } from "@atproto/oauth-client-node";
import { eq } from "drizzle-orm";
import type { Db } from "../../db";
import { meta } from "../../db/schema";
import {
  isOAuthLoopbackDev,
  oauthAppBaseUrl,
  oauthRedirectUri,
} from "./oauth-url";
import { buildOAuthScopeString } from "./oauth-scope";

const DPOP_KEY = "oauth:dpop_key";
const STATE_PREFIX = "oauth:state:";
const SESSION_PREFIX = "oauth:session:";

async function loadOrCreateDpopKey(db: Db): Promise<JoseKey> {
  const row = await db.select().from(meta).where(eq(meta.key, DPOP_KEY)).get();
  if (row) {
    return JoseKey.fromImportable(JSON.parse(row.value), "bazaar-dpop");
  }
  const key = await JoseKey.generate(["ES256"], "bazaar-dpop");
  const jwk = key.privateJwk;
  if (!jwk) throw new Error("Failed to generate DPoP key: no private JWK");
  const value = JSON.stringify(jwk);
  await db.insert(meta).values({ key: DPOP_KEY, value });
  return key;
}

function makeStateStore(db: Db) {
  return {
    async get(key: string): Promise<NodeSavedState | undefined> {
      const row = await db
        .select()
        .from(meta)
        .where(eq(meta.key, `${STATE_PREFIX}${key}`))
        .get();
      return row ? (JSON.parse(row.value) as NodeSavedState) : undefined;
    },
    async set(key: string, val: NodeSavedState): Promise<void> {
      const value = JSON.stringify(val);
      await db
        .insert(meta)
        .values({ key: `${STATE_PREFIX}${key}`, value })
        .onConflictDoUpdate({
          target: meta.key,
          set: { value, updatedAt: new Date() },
        });
    },
    async del(key: string): Promise<void> {
      await db.delete(meta).where(eq(meta.key, `${STATE_PREFIX}${key}`));
    },
  };
}

function makeSessionStore(db: Db) {
  return {
    async get(sub: string): Promise<NodeSavedSession | undefined> {
      const row = await db
        .select()
        .from(meta)
        .where(eq(meta.key, `${SESSION_PREFIX}${sub}`))
        .get();
      return row ? (JSON.parse(row.value) as NodeSavedSession) : undefined;
    },
    async set(sub: string, val: NodeSavedSession): Promise<void> {
      const value = JSON.stringify(val);
      await db
        .insert(meta)
        .values({ key: `${SESSION_PREFIX}${sub}`, value })
        .onConflictDoUpdate({
          target: meta.key,
          set: { value, updatedAt: new Date() },
        });
    },
    async del(sub: string): Promise<void> {
      await db.delete(meta).where(eq(meta.key, `${SESSION_PREFIX}${sub}`));
    },
  };
}

export async function createOAuthClient(db: Db): Promise<NodeOAuthClient> {
  const appUrl = oauthAppBaseUrl();
  const redirectUri = oauthRedirectUri();
  const isLoopbackDev = isOAuthLoopbackDev();

  const dpopKey = await loadOrCreateDpopKey(db);

  const scope = buildOAuthScopeString();

  // Loopback: auth servers derive declared scopes from the client_id URL query string, not from
  // a separate document — use buildAtprotoLoopbackClientMetadata so ?scope=... is embedded.
  const clientMetadata = isLoopbackDev
    ? buildAtprotoLoopbackClientMetadata({
        scope,
        redirect_uris: [redirectUri],
      })
    : {
        client_id: `${appUrl}/api/atproto/client-metadata.json`,
        client_name: "Bazaar",
        client_uri: appUrl,
        redirect_uris: [redirectUri] as [string, ...string[]],
        scope,
        grant_types: ["authorization_code", "refresh_token"] as [
          string,
          ...string[],
        ],
        response_types: ["code"] as [string, ...string[]],
        token_endpoint_auth_method: "none" as const,
        application_type: "web" as const,
        dpop_bound_access_tokens: true,
      };

  return new NodeOAuthClient({
    clientMetadata: clientMetadata as ConstructorParameters<
      typeof NodeOAuthClient
    >[0]["clientMetadata"],
    keyset: [dpopKey],
    stateStore: makeStateStore(db),
    sessionStore: makeSessionStore(db),
    requestLock: requestLocalLock,
  });
}

export type OAuthClient = Awaited<ReturnType<typeof createOAuthClient>>;
