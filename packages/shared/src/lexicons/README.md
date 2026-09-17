# Bazaar Lexicons — Apache-2.0

The **`.json` files in this directory are licensed under Apache-2.0** ([LICENSE](LICENSE)),
not under the AGPL-3.0-only licence that covers the rest of Bazaar.

## Why

These files are the schema contract for Bazaar's records on atproto. They describe a data
format, and a data format is only useful if anyone can implement it. Licensing them
permissively means another storefront, an indexer, a client or a validator can read and
write Bazaar records without taking on AGPL obligations — which is the whole point of
publishing a lexicon.

The application that implements these schemas stays AGPL-3.0-only. The schemas themselves
are open to everyone.

## Exact scope

**Apache-2.0** — the eight lexicon documents:

```
actor.merchant.json
actor.storefrontKeys.json
catalog.item.json
catalog.listing.json
catalog.product.json
defs.json
license.terms.json
purchase.receipt.json
```

**AGPL-3.0-only** — everything else in this directory, including `validate.ts` and
`docs.ts`. These are Bazaar's implementation, not part of the schema contract. If you want
to validate Bazaar records in your own project, read the JSON with your own tooling rather
than importing these.

Lexicon JSON cannot carry a comment, so there is no SPDX header inside the files
themselves. This directory-level `LICENSE` plus this README is the licence notice for them.

## Using these

Copy the JSON, implement against it, ship whatever licence you like. Attribution per
Apache-2.0 section 4 is all that's asked.

The NSIDs are under a namespace Bazaar controls. If you publish records using these exact
NSIDs, you're asserting they conform to these schemas — please don't diverge silently. Fork
the namespace instead if you need different semantics.

> **Alpha.** These schemas are still moving. They were consolidated from fifteen lexicons
> down to eight, and further change is likely before a stable release. Pin a commit if you
> depend on them.
