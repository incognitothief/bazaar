import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Hono } from "hono";
import {
  getApiListenBase,
  getNodeOAuthClient,
  getStoredTokenSet,
  oauthSessionStore,
} from "../atproto-oauth-client.js";

const COOKIE = "bazaar_atp_session";
const COOKIE_DID = "bazaar_atp_did";
const COOKIE_OPTS = {
  httpOnly: true,
  path: "/",
  sameSite: "Lax" as const,
  maxAge: 60 * 60 * 24 * 30,
};

export type StoredAtpSession = {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
};

function devFallbackAtpSession(): StoredAtpSession | null {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env.DEV_ATP_SESSION_JSON?.trim();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<StoredAtpSession>;
    if (!data?.did || !data?.accessJwt) return null;
    return {
      did: data.did,
      handle: data.handle ?? "",
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt ?? data.accessJwt,
    };
  } catch {
    return null;
  }
}

function signinFormHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Bazaar — sign in</title></head>
<body style="font-family:system-ui,sans-serif;max-width:24rem;margin:3rem auto;padding:0 1rem">
  <h1 style="font-size:1.25rem">Merchant sign in</h1>
  <p style="color:#555;font-size:0.9rem">Enter your Bluesky handle (or other ATProto handle).</p>
  <form method="get" action="/api/atproto/signin" style="display:flex;flex-direction:column;gap:0.75rem;margin-top:1rem">
    <label>Handle
      <input name="handle" type="text" required placeholder="you.bsky.social" style="width:100%;padding:0.5rem;margin-top:0.25rem"/>
    </label>
    <button type="submit" style="padding:0.5rem 1rem;cursor:pointer">Continue</button>
  </form>
</body>
</html>`;
}

export function createAtprotoRouter() {
  const r = new Hono();

  const oauthMeta = new Hono();
  oauthMeta.get("/client-metadata.json", async (c) => {
    try {
      const client = await getNodeOAuthClient();
      return c.json(client.clientMetadata);
    } catch (e) {
      return c.text(
        e instanceof Error ? e.message : "OAuth client not configured",
        503,
      );
    }
  });
  oauthMeta.get("/jwks.json", async (c) => {
    try {
      const client = await getNodeOAuthClient();
      return c.json(client.jwks);
    } catch (e) {
      return c.text(
        e instanceof Error ? e.message : "OAuth client not configured",
        503,
      );
    }
  });
  r.route("/oauth", oauthMeta);

  r.get("/dev-bootstrap", (c) => {
    if (process.env.NODE_ENV === "production") {
      return c.text("Not found", 404);
    }
    const dev = devFallbackAtpSession();
    if (!dev) {
      return c.text(
        "Set DEV_ATP_SESSION_JSON in packages/server/.env (single-line JSON). Non-production only.",
        400,
      );
    }
    setCookie(
      c,
      COOKIE,
      Buffer.from(JSON.stringify(dev), "utf8").toString("base64url"),
      COOKIE_OPTS,
    );
    const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(
      /\/$/,
      "",
    );
    return c.redirect(`${appUrl}/merchant/dashboard`);
  });

  r.get("/signin", async (c) => {
    const handle = c.req.query("handle")?.trim();
    if (!handle) {
      return c.html(signinFormHtml());
    }
    try {
      const client = await getNodeOAuthClient();
      const url = await client.authorize(handle, {
        state: crypto.randomUUID(),
      });
      return c.redirect(url.toString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.text(`OAuth authorize failed: ${msg}`, 500);
    }
  });

  r.get("/callback", async (c) => {
    try {
      const client = await getNodeOAuthClient();
      const params = new URL(
        c.req.url,
        `${getApiListenBase()}/`,
      ).searchParams;
      const { session } = await client.callback(params);
      setCookie(c, COOKIE_DID, session.did, COOKIE_OPTS);
      deleteCookie(c, COOKIE, { path: "/" });
      const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(
        /\/$/,
        "",
      );
      return c.redirect(`${appUrl}/merchant/dashboard`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.text(`OAuth callback failed: ${msg}`, 400);
    }
  });

  r.get("/session", async (c) => {
    const did = getCookie(c, COOKIE_DID);
    if (did) {
      const ts = await getStoredTokenSet(did);
      if (ts?.access_token) {
        return c.json({
          did,
          handle: "",
          accessJwt: ts.access_token,
          refreshJwt: ts.refresh_token ?? ts.access_token,
        } satisfies StoredAtpSession);
      }
    }

    const raw = getCookie(c, COOKIE);
    if (raw) {
      try {
        const json = Buffer.from(raw, "base64url").toString("utf8");
        const data = JSON.parse(json) as StoredAtpSession;
        if (data?.did && data?.accessJwt) return c.json(data);
      } catch {
        /* fall through */
      }
    }

    const dev = devFallbackAtpSession();
    if (dev) {
      setCookie(
        c,
        COOKIE,
        Buffer.from(JSON.stringify(dev), "utf8").toString("base64url"),
        COOKIE_OPTS,
      );
      return c.json(dev);
    }
    return c.json(null);
  });

  r.post("/signout", async (c) => {
    const did = getCookie(c, COOKIE_DID);
    deleteCookie(c, COOKIE_DID, { path: "/" });
    deleteCookie(c, COOKIE, { path: "/" });
    if (did) {
      await oauthSessionStore.del(did);
      try {
        const client = await getNodeOAuthClient();
        await client.revoke(did);
      } catch {
        /* ignore revoke errors */
      }
    }
    return c.json({ ok: true });
  });

  return r;
}
