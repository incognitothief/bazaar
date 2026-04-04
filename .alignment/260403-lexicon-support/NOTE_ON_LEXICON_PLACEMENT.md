Based on the stack documented in the proposals — Turbo monorepo, packages/shared importable by both packages/client and packages/server, Hono serving the lexicon resolution endpoint — the answer is straightforward.

Location
packages/shared/src/lexicons/
  defs.json
  catalog.item.digital.json
  catalog.item.physical.json
  catalog.item.bundle.json
  catalog.collection.json
  catalog.listing.json
  catalog.recording.json
  catalog.composition.json
  license.terms.json
  purchase.receipt.json
  purchase.consent.json
  purchase.stock.json
  purchase.fulfillment.json
  actor.profile.json
One file per lexicon, named by the trailing segment of the NSID. The full NSID is already inside each file as the id field so nothing is lost.

Alongside them
packages/shared/src/lexicons/
  docs.ts          ← imports all JSON; exports `lexicons` map keyed by NSID and `BAZAAR_LEXICON_DOCS`
  validate.ts      ← `validateBazaarRecord` via `@atproto/lexicon` Lexicons

Package exports:
- `@bazaar/shared` — `lexicons`, `validateBazaarRecord`, etc.
- `@bazaar/shared/lexicons` — same map (`docs` module) for consumers that want a lexicon-only entry

The Hono route is mounted on the main app in `packages/server/src/index.ts`:

```
GET /xrpc/com.atproto.lexicon.get?lexicon=<nsid>
```

Client-side, lexicons can be imported from `@bazaar/shared` when needed — no fetch required at runtime if bundled at build time.

What not to do
Don't put them in packages/client or packages/server directly. They need to be the single source of truth for both. Don't generate TypeScript types from them manually — if you want typed record shapes, use the ATProto lexicon codegen tooling (lex gen) pointed at this directory, and emit the output into packages/shared/src/types/. That way the JSON is canonical and the types are derived, never the other way around.
