import { Hono } from "hono";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getSessionAgent } from "../lib/atproto/session";
import {
  buildBazaarPid,
  buildBazaarRid,
  buildBazaarWid,
  identifiersSigningConfigured,
  type WidWriterInput,
} from "../lib/bazaarIdentifiers";

export function createIdentifiersRouter(oauthClient: OAuthClient) {
  const r = new Hono();

  r.post("/rid", async (c) => {
    if (!identifiersSigningConfigured()) {
      return c.json({ error: "identifiers_unconfigured" }, 503);
    }
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json<{
      artistDid?: string;
      fileCid?: string;
      fileChecksum?: string;
      createdAt?: string;
    }>();
    const artistDid = body.artistDid?.trim();
    const fileCid = body.fileCid?.trim();
    const fileChecksum = body.fileChecksum?.trim();
    const createdAt = body.createdAt?.trim();
    if (!artistDid || !fileCid || !fileChecksum || !createdAt) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (artistDid !== sess.did) {
      return c.json({ error: "artist_did_mismatch" }, 400);
    }
    try {
      const bazaarRid = buildBazaarRid({
        artistDid,
        fileCid,
        fileChecksum,
        createdAt,
      });
      return c.json({ bazaarRid });
    } catch (e) {
      console.error("identifiers/rid:", e);
      return c.json(
        { error: "sign_failed", message: e instanceof Error ? e.message : "" },
        500,
      );
    }
  });

  r.post("/wid", async (c) => {
    if (!identifiersSigningConfigured()) {
      return c.json({ error: "identifiers_unconfigured" }, 503);
    }
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json<{
      artistDid?: string;
      compositionTitle?: string;
      writers?: WidWriterInput[];
      createdAt?: string;
    }>();
    const artistDid = body.artistDid?.trim();
    const compositionTitle = body.compositionTitle?.trim();
    const createdAt = body.createdAt?.trim();
    if (!artistDid || !compositionTitle || !createdAt) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (artistDid !== sess.did) {
      return c.json({ error: "artist_did_mismatch" }, 400);
    }
    const writers = Array.isArray(body.writers) ? body.writers : [];
    try {
      const bazaarWid = buildBazaarWid({
        artistDid,
        compositionTitle,
        writers,
        createdAt,
      });
      return c.json({ bazaarWid });
    } catch (e) {
      console.error("identifiers/wid:", e);
      return c.json(
        { error: "sign_failed", message: e instanceof Error ? e.message : "" },
        500,
      );
    }
  });

  r.post("/pid", async (c) => {
    if (!identifiersSigningConfigured()) {
      return c.json({ error: "identifiers_unconfigured" }, 503);
    }
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json<{
      artistDid?: string;
      collectionUri?: string;
      releaseDate?: string;
    }>();
    const artistDid = body.artistDid?.trim();
    const collectionUri = body.collectionUri?.trim();
    const releaseDate = body.releaseDate?.trim();
    if (!artistDid || !collectionUri || !releaseDate) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (artistDid !== sess.did) {
      return c.json({ error: "artist_did_mismatch" }, 400);
    }
    try {
      const bazaarPid = buildBazaarPid({
        artistDid,
        collectionUri,
        releaseDate,
      });
      return c.json({ bazaarPid });
    } catch (e) {
      console.error("identifiers/pid:", e);
      return c.json(
        { error: "sign_failed", message: e instanceof Error ? e.message : "" },
        500,
      );
    }
  });

  return r;
}
