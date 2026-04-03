import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Hono } from "hono";

const COOKIE = "bazaar_atp_session";
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

export function createAtprotoRouter() {
  const r = new Hono();

  r.get("/signin", (c) => {
    const clientId = process.env.ATPROTO_OAUTH_CLIENT_ID;
    const redirectUri =
      process.env.ATPROTO_OAUTH_REDIRECT_URI ??
      `${process.env.APP_URL ?? "http://localhost:3000"}/api/atproto/callback`;
    const service = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
    if (!clientId) {
      return c.text(
        "Set ATPROTO_OAUTH_CLIENT_ID and related OAuth env vars to enable sign-in.",
        503,
      );
    }
    const url = new URL("/oauth/authorize", service);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "transition:generic");
    return c.redirect(url.toString());
  });

  r.get("/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) {
      return c.text("Missing OAuth code", 400);
    }
    const clientId = process.env.ATPROTO_OAUTH_CLIENT_ID;
    const clientSecret = process.env.ATPROTO_OAUTH_CLIENT_SECRET;
    const redirectUri =
      process.env.ATPROTO_OAUTH_REDIRECT_URI ??
      `${process.env.APP_URL ?? "http://localhost:3000"}/api/atproto/callback`;
    if (!clientId || !clientSecret) {
      return c.text("OAuth is not fully configured on the server.", 503);
    }
    const service = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
    const tokenUrl = new URL("/oauth/token", service);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const tokRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokRes.ok) {
      const err = await tokRes.text();
      return c.text(`Token exchange failed: ${err}`, 400);
    }
    const tok = (await tokRes.json()) as {
      access_token: string;
      refresh_token?: string;
      sub?: string;
    };
    const session: StoredAtpSession = {
      did: tok.sub ?? "",
      handle: "",
      accessJwt: tok.access_token,
      refreshJwt: tok.refresh_token ?? tok.access_token,
    };
    if (!session.did) {
      return c.text("Token response missing subject (did)", 400);
    }
    setCookie(c, COOKIE, Buffer.from(JSON.stringify(session), "utf8").toString("base64url"), COOKIE_OPTS);
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    return c.redirect(`${appUrl}/merchant/dashboard`);
  });

  r.get("/session", (c) => {
    const raw = getCookie(c, COOKIE);
    if (!raw) return c.json(null);
    try {
      const json = Buffer.from(raw, "base64url").toString("utf8");
      const data = JSON.parse(json) as StoredAtpSession;
      if (!data?.did || !data?.accessJwt) return c.json(null);
      return c.json(data);
    } catch {
      return c.json(null);
    }
  });

  r.post("/signout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return r;
}
