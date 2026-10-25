# Bazaar Lexicons

The `.json` files in this directory are the schema contract for Bazaar's records on atproto.
Like the rest of Bazaar they are MIT licensed (see the [repository LICENSE](../../../../LICENSE)).

The eight lexicon documents:

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

`validate.ts` and `docs.ts` are Bazaar's implementation, not part of the schema contract. If
you want to validate Bazaar records in your own project, read the JSON with your own tooling
rather than importing these.

## Using these

Copy the JSON, implement against it, ship whatever licence you like.

The NSIDs are under a namespace Bazaar controls. If you publish records using these exact
NSIDs, you're asserting they conform to these schemas — please don't diverge silently. Fork
the namespace instead if you need different semantics.

> **Alpha.** These schemas are still moving. They were consolidated from fifteen lexicons
> down to eight, and further change is likely before a stable release. Pin a commit if you
> depend on them.
