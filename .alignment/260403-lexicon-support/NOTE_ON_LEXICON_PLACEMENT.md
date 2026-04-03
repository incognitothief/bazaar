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
  license.terms.json
  purchase.receipt.json
  purchase.stock.json
  purchase.fulfillment.json
  actor.profile.json
One file per lexicon, named by the trailing segment of the NSID. The full NSID is already inside each file as the id field so nothing is lost.

Alongside them
packages/shared/src/lexicons/
  index.ts          ← re-exports all lexicons as a typed map keyed by NSID
  validate.ts       ← thin wrapper around your ATProto SDK's lexicon validator
The index.ts gives both client and server a single import point:
tsimport { lexicons } from '@bazaar/shared/lexicons'
// lexicons['diamonds.whereditgo.bazaar.purchase.receipt'] → the JSON

The Hono route
Once the domain is configured, your server exposes:
ts// packages/server/src/routes/lexicon.ts
app.get('/xrpc/com.atproto.lexicon.get', (c) => {
  const id = c.req.query('lexicon')
  const lex = lexicons[id]
  if (!lex) return c.json({ error: 'LexiconNotFound' }, 404)
  return c.json(lex)
})
That's the only server-side concern. Client-side, the lexicons are just imported directly from shared — no fetch needed at runtime since they're bundled at build time.

What not to do
Don't put them in packages/client or packages/server directly. They need to be the single source of truth for both. Don't generate TypeScript types from them manually — if you want typed record shapes, use the ATProto lexicon codegen tooling (lex gen) pointed at this directory, and emit the output into packages/shared/src/types/. That way the JSON is canonical and the types are derived, never the other way around.