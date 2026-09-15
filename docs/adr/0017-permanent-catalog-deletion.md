# ADR 0017: Permanent catalog deletion

## Status

Accepted.

## Date

2026-09-14

## Context

Bazaar had no way for a merchant to remove inventory. Records could be created
and updated; listings could be retired; but a `catalog.product` (or a legacy
`catalog.item.digital` / `catalog.collection`) and its R2 bytes stayed forever.

The immediate driver is the legacy-lexicon deprecation: clearing legacy
inventory through the app is far safer than hand-editing a PDS and a bucket,
and it leaves the demolition with no live legacy records to degrade against.
But the gap is real independent of that cleanup — "I cannot delete my own
inventory" is not a defensible position for a self-hostable storefront.

The only pre-existing deletion path, `assets/remove` in `routes/merchant.ts`,
deletes a product asset. It drops its `inventory_upload_object` row even when
the R2 delete throws (the failure is `console.warn`'d and execution continues).
That is survivable for an asset — cover art is re-uploadable and the product
record still names it. It is not a safe template for entry deletion.

## Decision

### One path, not one per record type

`lib/deleteCatalogEntry.ts` operates on an AT-URI, not a record type. A product
and a legacy entry differ in exactly one respect — how their bytes are resolved
— so that is the only branch:

- **Product**: `catalogItems.objectId` → `inventory_upload_object.r2Key`, plus
  `catalogProductAssets` objects and the `packageZipKey` precomputed download.
- **Legacy**: no `objectId` link exists, so look up `inventory_upload_object`
  by the record's own `rkey`, and only if that misses, recompute the key via
  `inventoryObjectKey()` the way the legacy download path does.

Everything else — ownership, listing checks, cascade, verification, record
deletion — is shared. When the legacy record types are removed, one branch goes
with them and the feature is untouched.

### Order is the safety argument

```
1. delete R2 bytes
2. VERIFY every byte is gone   <- abort here leaves EVERYTHING intact
3. drop ERP rows
4. delete PDS records          <- the last pointer, so it dies last
```

A failure at 1 or 2 aborts with records untouched: the merchant retries and the
manifest still resolves. The inverse order fails unrecoverably, because for a
legacy entry the record's `rkey` is the only thing that can regenerate its R2
key. **Bytes without a record are invisible garbage; a record without bytes is a
visible, retryable inconsistency.** We fail toward the latter.

Step 2 exists because a delete that silently no-ops (wrong bucket, permissions,
a key that never matched) would otherwise reach step 4 and strand the bytes. An
object already absent is treated as success, not failure.

### Cascade

- **Listings block.** Deletion is refused while any `catalog.listing` points at
  the entry or its children. The merchant unlists first. Listings are never
  auto-deleted — unlisting is reversible, deletion is not, and silently
  retracting a live offer is not a side effect a delete should have.
- **Items cascade down.** Deleting a product deletes every `catalog.item` it
  composes.
- **Shared items survive.** An item still composed by another product is kept
  and reported in the manifest, reusing the reference-count idea from
  `assets/remove`.

Product-level only for now. `catalog.product.items` has `minLength: 1`, so
item-level deletion would need to either block on the last item or cascade
upward; that is deferred rather than guessed at.

### Two gates

The manifest (`POST /catalog/entry/delete-manifest`) enumerates what would be
destroyed without destroying it, and backs the confirmation dialog. The delete
(`POST /catalog/entry/delete`) **rebuilds the manifest server-side** and ignores
the client's copy, so a listing created while the dialog sat open still blocks.
`confirm` must equal the entry's exact title.

### Scopes

`delete` actions are declared in `oauth-scope.ts` for correctness. They are not
what authorizes these calls today — `transition:generic`, already in the scope
string, is. No re-authorization is required, and none was triggered. The
granular entries become load-bearing when `transition:generic` goes away.

## Consequences

**Positive**
- Merchants can remove their own inventory, completely, without operator help.
- Legacy inventory can be cleared through the app rather than by hand, which is
  the precondition for the legacy-lexicon demolition.
- The failure mode is recoverable by construction, and the ordering guarantee is
  covered by tests that assert the DB and PDS are untouched on abort.

**Negative / trade-offs**
- Deletion is genuinely irreversible: no trash, no soft-delete, no undo. A
  merchant who deletes something they still wanted must re-upload it.
- Buyers holding receipts for a deleted entry lose their downloads permanently.
  The receipt stays valid in their repo and the manifest warns with a count, but
  nothing restores the bytes. This is inherent to letting merchants delete, not
  an implementation choice.
- The client/server split means a crash between step 3 and step 4 leaves records
  without bytes. Re-running the delete resolves it; this is the direction we
  deliberately fail in.

**Deferred**
- Item-level deletion (see `minLength: 1` above).
- Soft-delete / recovery window. Deliberately not built: it implies retention
  policy, storage accounting, and a restore path, none of which exist yet.
- Warning copy is boilerplate pending a wording pass.
