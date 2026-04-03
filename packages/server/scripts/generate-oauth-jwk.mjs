#!/usr/bin/env node
/**
 * Prints a private ES256 JWK (one line) for ATPROTO_OAUTH_PRIVATE_KEY_JWK in .env
 * Run: node scripts/generate-oauth-jwk.mjs
 */
import { JoseKey } from "@atproto/jwk-jose";

const key = await JoseKey.generate(["ES256"], "bazaar-oauth");
const jwk = key.privateJwk;
if (!jwk) throw new Error("expected private JWK");
console.log(JSON.stringify(jwk));
