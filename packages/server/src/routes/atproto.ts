import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import { Agent } from "@atproto/api";
import { eq } from "drizzle-orm";
import type { OAuthClient } from "../lib/atproto/oauth";
import {
  buildBuyerOAuthScopeString,
  buildOAuthScopeString,
} from "../lib/atproto/oauth-scope";
import {
  resolveDidForHandle,
  resolveHandleForDid,
  resolvePdsForDid,
} from "../lib/atproto/resolvePds";
import { oauthAppBaseUrl, oauthRedirectUri } from "../lib/atproto/oauth-url";

function clientScope(oauthClient: OAuthClient): string {
  return oauthClient.clientMetadata.scope ?? buildOAuthScopeString();
}
import type { Db } from "../db";
import { licenses, meta } from "../db/schema";

const LICENSE_TERMS_COLLECTION = "diamonds.whereditgo.bazaar.license.terms";

/**
 * Best-effort write-time capture of license.terms content into the local
 * licenses table, keyed by CID. Never throws — the PDS write already
 * succeeded by the time this runs, so a capture failure must not fail the
 * request. license.terms is create-only (no update scope), so this only
 * needs to hook createRecord, not putRecord.
 */
async function captureLicenseTerms(
  db: Db,
  merchantDid: string,
  record: unknown,
  uri: string,
  cid: string,
): Promise<void> {
  if (typeof record !== "object" || record === null) return;
  const r = record as Record<string, unknown>;
  const title = r.title;
  const version = r.version;
  const licenseText = r.licenseText;
  const checkoutConsentRequired = r.checkoutConsentRequired;
  if (
    typeof title !== "string" ||
    typeof version !== "string" ||
    typeof licenseText !== "string" ||
    typeof checkoutConsentRequired !== "boolean"
  ) {
    return;
  }
  try {
    await db
      .insert(licenses)
      .values({
        cid,
        uri,
        merchantDid,
        title,
        version,
        licenseText,
        checkoutConsentRequired,
      })
      .onConflictDoNothing();
  } catch {
    // Best-effort — the PDS write already succeeded.
  }
}

const COOKIE = "bazaar_atp_session";
const COOKIE_OPTS = {
  httpOnly: true,
  path: "/",
  sameSite: "Lax" as const,
  maxAge: 60 * 60 * 24 * 30,
};
const RETURN_COOKIE = "bazaar_oauth_return";
const RETURN_COOKIE_OPTS = {
  httpOnly: true,
  path: "/",
  sameSite: "Lax" as const,
  maxAge: 600,
};
const HANDLE_PREFIX = "oauth:handle:";

/** Same-origin path only; blocks open redirects. */
function safeOauthReturnPath(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const s = raw.trim();
  if (s.length > 2048) return null;
  if (!s.startsWith("/")) return null;
  if (s.startsWith("//")) return null;
  if (s.includes("://")) return null;
  if (s.includes("\\")) return null;
  if (s.startsWith("/merchant/signin")) return null;
  return s;
}

export function createAtprotoRouter(db: Db, oauthClient: OAuthClient) {
  const r = new Hono();

  // Serves client metadata at the client_id URL — required for production OAuth.
  // The client_id env var must equal `${APP_URL}/api/atproto/client-metadata.json`.
  r.get("/client-metadata.json", (c) => {
    const appUrl = oauthAppBaseUrl();
    const redirectUri = oauthRedirectUri();
    return c.json({
      client_id: `${appUrl}/api/atproto/client-metadata.json`,
      client_name: "Bazaar",
      client_uri: appUrl,
      redirect_uris: [redirectUri],
      scope: clientScope(oauthClient),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
      dpop_bound_access_tokens: true,
    });
  });

  // Step 1: initiate OAuth — redirect user to their PDS authorization page.
  // The `handle` query param tells ATProto which PDS to discover (e.g. user.bsky.social).
  r.get("/signin", async (c) => {
    const handle = c.req.query("handle");
    if (!handle) {
      return c.text("Missing ?handle query parameter (e.g. user.bsky.social)", 400);
    }
    const returnPath = safeOauthReturnPath(c.req.query("returnTo"));
    if (returnPath) {
      setCookie(c, RETURN_COOKIE, returnPath, RETURN_COOKIE_OPTS);
    } else {
      deleteCookie(c, RETURN_COOKIE, { path: "/" });
    }
    // Least-privilege: buyers only ever need to write purchase attestations to
    // their own repo, so their session requests a narrower scope than the full
    // merchant superset declared in client metadata. `role` is a client-supplied
    // hint (defaults to "buyer") — worst case a mislabeled buyer session simply
    // can't write merchant-only collections, which fails safe.
    const role = c.req.query("role") === "merchant" ? "merchant" : "buyer";
    try {
      const scope =
        role === "buyer" ? buildBuyerOAuthScopeString() : undefined;
      const url = await oauthClient.authorize(handle, scope ? { scope } : {});
      return c.redirect(url.toString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`Failed to initiate OAuth: ${msg}`, 500);
    }
  });

  // Step 2: PDS redirects back here with code + state.
  // The NodeOAuthClient handles PAR state verification, PKCE, and DPoP token exchange.
  r.get("/callback", async (c) => {
    const params = new URLSearchParams(c.req.url.split("?")[1] ?? "");
    try {
      const { session } = await oauthClient.callback(params);
      const agent = new Agent(session);
      const did = session.did;

      // Resolve the handle and cache it so /session doesn't need a live ATProto call
      let handle = "";
      try {
        const desc = await agent.com.atproto.repo.describeRepo({ repo: did });
        handle = desc.data.handle ?? "";
      } catch {
        // non-fatal — handle will be empty until a later session restore resolves it
      }
      if (handle) {
        await db
          .insert(meta)
          .values({ key: `${HANDLE_PREFIX}${did}`, value: handle })
          .onConflictDoUpdate({
            target: meta.key,
            set: { value: handle, updatedAt: new Date() },
          });
      }

      setCookie(c, COOKIE, did, COOKIE_OPTS);

      const rawReturn = getCookie(c, RETURN_COOKIE);
      deleteCookie(c, RETURN_COOKIE, { path: "/" });
      const returnPath = safeOauthReturnPath(rawReturn) ?? "/";

      return c.redirect(`${oauthAppBaseUrl()}${returnPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`OAuth callback failed: ${msg}`, 400);
    }
  });

  // Returns the signed-in user's DID + handle, or null if no valid session.
  // Restoring the session also silently refreshes DPoP tokens when needed.
  r.get("/session", async (c) => {
    const did = getCookie(c, COOKIE);
    if (!did) return c.json(null);
    try {
      await oauthClient.restore(did);
      const row = await db
        .select()
        .from(meta)
        .where(eq(meta.key, `${HANDLE_PREFIX}${did}`))
        .get();
      return c.json({ did, handle: row?.value ?? "" });
    } catch {
      // Session invalid or refresh failed — clear the stale cookie
      deleteCookie(c, COOKIE, { path: "/" });
      return c.json(null);
    }
  });

  // Generic identity resolver: accepts either `did` or `handle` and resolves the full
  // identity (did, pds, handle) from whichever was given.
  //
  // `com.atproto.repo.getRecord` / `listRecords` are PDS-hosted endpoints — they only
  // work against the host that has the repo, not a single universal endpoint — so the
  // browser calls this before hitting a repo directly.
  //
  // `handle` resolution never goes through a third-party AppView's `resolveHandle`
  // convenience endpoint (e.g. bsky.social) — it's the protocol-level DNS/well-known
  // lookup, bidirectionally verified against the resolved DID's own document. See
  // resolveDidForHandle in resolvePds.ts for the full rationale.
  //
  // The `handle` field in the response (whether resolving from `did` or `handle`) is
  // the DID document's *claimed* handle, which is NOT bidirectionally verified when the
  // request came in by `did` — display-only in that case, same caveat as
  // resolveHandleForDid. When the request came in by `handle`, the returned `did` is
  // fully verified (that's what resolveDidForHandle guarantees) — it's the `handle`
  // echoed back in the response that's merely the same string you sent in.
  //
  // Public: identity data is public info, no auth needed. Cached in resolvePds.ts.
  r.get("/resolve-pds", async (c) => {
    const didParam = c.req.query("did")?.trim();
    const handleParam = c.req.query("handle")?.trim();

    let did: string | undefined = didParam;
    if (!did && handleParam) {
      did = (await resolveDidForHandle(handleParam)) ?? undefined;
      if (!did) return c.json({ error: "not_found" }, 404);
    }
    if (!did || !did.startsWith("did:")) {
      return c.json({ error: "invalid_did" }, 400);
    }

    const [pds, handle] = await Promise.all([
      resolvePdsForDid(did),
      resolveHandleForDid(did),
    ]);
    if (!pds) return c.json({ error: "not_found" }, 404);
    return c.json({ did, pds, handle: handle ?? null });
  });

  r.post("/signout", async (c) => {
    const did = getCookie(c, COOKIE);
    if (did) {
      try {
        await oauthClient.revoke(did);
      } catch {
        // best-effort revocation
      }
    }
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ── ATProto write proxies ─────────────────────────────────────────────────
  // The DPoP keypair lives on the server, so all authenticated PDS writes must
  // go through these endpoints.  Read operations (listRecords, getRecord) are
  // served from public ATProto endpoints directly by the browser.

  async function getSessionAgent(c: Context): Promise<Agent | null> {
    const did = getCookie(c, COOKIE);
    if (!did) return null;
    try {
      const oauthSession = await oauthClient.restore(did);
      return new Agent(oauthSession);
    } catch {
      return null;
    }
  }

  r.post("/repo/createRecord", async (c) => {
    const did = getCookie(c, COOKIE);
    if (!did) return c.json({ error: "Unauthorized" }, 401);
    const agent = await getSessionAgent(c);
    if (!agent) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json<{
      collection: string;
      record: unknown;
      rkey?: string;
    }>();
    const res = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: body.collection,
      record: body.record as Record<string, unknown>,
      ...(body.rkey ? { rkey: body.rkey } : {}),
    });
    if (body.collection === LICENSE_TERMS_COLLECTION) {
      await captureLicenseTerms(
        db,
        did,
        body.record,
        res.data.uri,
        res.data.cid,
      );
    }
    return c.json({ uri: res.data.uri, cid: res.data.cid });
  });

  r.post("/repo/putRecord", async (c) => {
    const did = getCookie(c, COOKIE);
    if (!did) return c.json({ error: "Unauthorized" }, 401);
    const agent = await getSessionAgent(c);
    if (!agent) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json<{
      collection: string;
      rkey: string;
      record: unknown;
      swapRecord?: string;
    }>();
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: body.collection,
      rkey: body.rkey,
      record: body.record as Record<string, unknown>,
      ...(body.swapRecord ? { swapRecord: body.swapRecord } : {}),
    });
    return c.json({ ok: true });
  });

  r.post("/repo/deleteRecord", async (c) => {
    const did = getCookie(c, COOKIE);
    if (!did) return c.json({ error: "Unauthorized" }, 401);
    const agent = await getSessionAgent(c);
    if (!agent) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json<{ collection: string; rkey: string }>();
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: body.collection,
      rkey: body.rkey,
    });
    return c.json({ ok: true });
  });

  r.post("/blob", async (c) => {
    const agent = await getSessionAgent(c);
    if (!agent) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);

    const res = await agent.uploadBlob(file, {
      headers: file.type ? { "Content-Type": file.type } : undefined,
    });
    const ref = res.data.blob.ref;
    const cid = typeof ref === "string" ? ref : ref.toString();
    return c.json({ cid });
  });

  return r;
}
