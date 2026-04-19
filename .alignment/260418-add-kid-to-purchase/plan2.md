# Bazaar — Service DID Document: Implementation Spec

**Date:** 17 April 2026
**Status:** Implementation ready
**Priority:** Blocking — `appDid` is unresolvable until this is shipped. Any `appSig` or `bazaarIdentifier.sig` verification attempt by a third party will fail.

---

## Background

Bazaar's service DID is `did:web:bazaar.whereditgo.diamonds`. The `did:web` resolution method requires a DID document to be served at:

```
GET https://bazaar.whereditgo.diamonds/.well-known/did.json
```

This route does not currently exist. Until it does, `appDid` cannot be resolved, and no signed record produced by Bazaar is externally verifiable.

The DID document is static config — it is not generated dynamically. It lives as a committed JSON file in the repo and is served verbatim by a Hono route. Changes to the document (adding a retired key, rotating the active key) are made by editing the file, committing, and redeploying. The service never modifies its own DID document programmatically.

---

## File structure

```
packages/server/
  src/
    routes/
      wellKnown.ts          ← new: Hono route handler for /.well-known/*
    index.ts                ← register wellKnown routes
  config/
    did-document.json       ← new: static DID document content
scripts/
  generate-app-keypair.ts   ← update: output APP_SERVICE_KID and DID document snippet
```

---

## `packages/server/config/did-document.json`

This file is the source of truth for the service DID document. It is committed to the repo and treated as append-only for the `verificationMethod` array — keys are added on rotation, never removed.

Initial content (single active key):

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/multikey/v1"
  ],
  "id": "did:web:bazaar.whereditgo.diamonds",
  "verificationMethod": [
    {
      "id": "did:web:bazaar.whereditgo.diamonds#app-key-2026-04-17",
      "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds",
      "publicKeyMultibase": "REPLACE_WITH_ACTUAL_PUBLIC_KEY_MULTIBASE"
    }
  ],
  "assertionMethod": ["did:web:bazaar.whereditgo.diamonds#app-key-2026-04-17"],
  "authentication": []
}
```

Rules for this file:

- `verificationMethod` is append-only. A key added here is never removed — retired keys remain indefinitely to support verification of historical signed records.
- `assertionMethod` references only the currently active key fragment. On rotation, update this array to reference the new key and leave the old key in `verificationMethod`.
- `authentication` is empty and stays empty. Bazaar does not use its service DID for authentication — only for assertion (signing).
- `publicKeyMultibase` must be the multibase-encoded public key corresponding to `APP_SERVICE_KEY`. The key generation script (see below) outputs this value.

On key rotation, append to `verificationMethod`:

```json
{
  "id": "did:web:bazaar.whereditgo.diamonds#app-key-2026-10-01",
  "type": "Multikey",
  "controller": "did:web:bazaar.whereditgo.diamonds",
  "publicKeyMultibase": "REPLACE_WITH_NEW_PUBLIC_KEY_MULTIBASE"
}
```

And update `assertionMethod` to:

```json
["did:web:bazaar.whereditgo.diamonds#app-key-2026-10-01"]
```

---

## `packages/server/src/routes/wellKnown.ts`

```ts
import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";

export const wellKnown = new Hono();

const didDocument = JSON.parse(
  readFileSync(join(__dirname, "../../config/did-document.json"), "utf-8"),
);

wellKnown.get("/did.json", (c) => {
  return c.json(didDocument, 200, {
    "Content-Type": "application/did+ld+json",
    "Cache-Control": "public, max-age=3600",
  });
});
```

The document is read once at startup and held in memory. A server restart is required to pick up changes to the file — this is intentional. Key rotation is a deliberate operator action that includes a redeploy.

`Cache-Control: public, max-age=3600` allows resolvers to cache the document for one hour. This is consistent with standard `did:web` deployment. Keep this value at or below 3600 — lower values reduce propagation delay after a rotation but increase resolver load.

---

## `packages/server/src/index.ts` — register route

Mount the `wellKnown` router at `/.well-known`:

```ts
import { wellKnown } from "./routes/wellKnown";

app.route("/.well-known", wellKnown);
```

Confirm this mount point does not conflict with any existing ATProto OAuth well-known routes (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`). Those routes should already exist if OAuth is working. The DID route is additive.

---

## Key generation script update — `scripts/generate-app-keypair.ts`

The existing key generation script produces a P-256 keypair and outputs the private key for `APP_SERVICE_KEY`. It must be updated to also output:

1. The public key in multibase encoding (for `did-document.json`)
2. The suggested `APP_SERVICE_KID` value
3. A ready-to-paste `verificationMethod` entry for `did-document.json`

Updated output format:

```
Bazaar app service keypair
──────────────────────────────────────────────────

Private key (set as APP_SERVICE_KEY in environment):
  -----BEGIN EC PRIVATE KEY-----
  ...
  -----END EC PRIVATE KEY-----

Public key (multibase encoded):
  zDnaeWJjH...

Suggested APP_SERVICE_KID:
  app-key-2026-04-17

Add to packages/server/config/did-document.json → verificationMethod[]:
  {
    "id": "did:web:bazaar.whereditgo.diamonds#app-key-2026-04-17",
    "type": "Multikey",
    "controller": "did:web:bazaar.whereditgo.diamonds",
    "publicKeyMultibase": "zDnaeWJjH..."
  }

If this is your first key, also set assertionMethod to:
  ["did:web:bazaar.whereditgo.diamonds#app-key-2026-04-17"]

Environment variables to set:
  APP_SERVICE_KEY=<private key PEM, single line with \n escapes>
  APP_SERVICE_KID=app-key-2026-04-17
```

The multibase encoding for a P-256 public key uses the `z` prefix (base58btc) over the SPKI DER bytes. Use `@atproto/crypto` if it exposes a multibase encoding utility, otherwise use the `multibase` npm package with the `base58btc` codec.

---

## Environment variables

```
# packages/server/.env.example

# App service keypair — generated by scripts/generate-app-keypair.ts
APP_SERVICE_KEY=         # PEM-encoded P-256 private key (required)
APP_SERVICE_KID=         # Key identifier matching verificationMethod entry in did-document.json
                         # Format: app-key-YYYY-MM-DD
                         # Required in production. If absent, server logs a startup warning.
                         # Example: app-key-2026-04-17
```

Add a startup check in `packages/server/src/index.ts`:

```ts
if (!process.env.APP_SERVICE_KID) {
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[WARN] APP_SERVICE_KID is not set. Signed records will not carry a kid field. " +
        "Key rotation verification will require exhaustive key search. " +
        "Set APP_SERVICE_KID to the fragment of the active key in did-document.json.",
    );
  }
}
```

Do not throw on missing `APP_SERVICE_KID` — the server remains functional, signing continues, `kid` is simply omitted from new records. This matches the optional field definition in the lexicon.

---

## Verification — manual test after deploy

After deploying, confirm resolution works:

```sh
# Direct HTTP fetch
curl -H "Accept: application/did+ld+json" \
  https://bazaar.whereditgo.diamonds/.well-known/did.json

# Via ATProto DID resolver (confirms did:web resolution chain works)
npx @atproto/cli resolve did:web:bazaar.whereditgo.diamonds
```

Expected response shape:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", "..."],
  "id": "did:web:bazaar.whereditgo.diamonds",
  "verificationMethod": [...],
  "assertionMethod": [...]
}
```

Confirm `Content-Type` header is `application/did+ld+json`. Some resolvers are strict about this.

---

## Key rotation operational procedure (for reference)

When rotation is required:

```
1. Run scripts/generate-app-keypair.ts → new keypair, new kid, new verificationMethod entry
2. Append new verificationMethod entry to config/did-document.json
3. Update assertionMethod in config/did-document.json to reference new kid fragment
4. Do NOT remove the old verificationMethod entry
5. Update APP_SERVICE_KEY and APP_SERVICE_KID in Fly secrets (or equivalent)
6. Commit did-document.json change to repo
7. Deploy — new document is served, new key signs new records immediately
8. Verify resolution: curl https://bazaar.whereditgo.diamonds/.well-known/did.json
9. Confirm both old and new keys appear in verificationMethod
```

---

## Confirmation checklist

- [ ] `packages/server/config/did-document.json` exists with correct structure
- [ ] `publicKeyMultibase` in did-document.json matches the public key corresponding to `APP_SERVICE_KEY`
- [ ] `/.well-known/did.json` route registered in Hono and returns the document
- [ ] `Content-Type: application/did+ld+json` header present on response
- [ ] `Cache-Control: public, max-age=3600` header present on response
- [ ] Route does not conflict with existing OAuth well-known routes
- [ ] `scripts/generate-app-keypair.ts` outputs multibase public key and did-document.json snippet
- [ ] `APP_SERVICE_KID` documented in `.env.example`
- [ ] Startup warning logged if `APP_SERVICE_KID` absent in production
- [ ] Manual resolution test passes via curl and ATProto resolver
