import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { Agent } from "@atproto/api";
import type { OAuthClient } from "./oauth";

const COOKIE = "bazaar_atp_session";

export async function getSessionAgent(
  c: Context,
  oauthClient: OAuthClient,
): Promise<{ did: string; agent: Agent } | null> {
  const did = getCookie(c, COOKIE);
  if (!did) return null;
  try {
    const oauthSession = await oauthClient.restore(did);
    return { did, agent: new Agent(oauthSession) };
  } catch {
    return null;
  }
}
