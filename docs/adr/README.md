# Bazaar Architecture Decision Records

`docs/adr` is the canonical decision log. `.alignment/` (implementation reports ADRs 0001–0011
were originally backfilled from) is deprecated — new decisions get an ADR here directly, not a new
`.alignment/` folder.

| ADR | Title | Date |
|-----|-------|------|
| [0001](0001-application-stack.md) | Application stack and deployment | 2026-03-31 |
| [0002](0002-frontend-architecture.md) | Frontend architecture and UI conventions | 2026-04-02 |
| [0003](0003-lexicon-architecture.md) | Lexicon architecture and commerce data model | 2026-04-03 |
| [0004](0004-payment-flow.md) | Payment flow and PDS fulfillment | 2026-04-04 |
| [0005](0005-actor-merchant.md) | Merchant actor record | 2026-04-04 |
| [0006](0006-license-flow.md) | License terms lifecycle | 2026-04-04 |
| [0007](0007-digital-inventory-r2.md) | Digital inventory and R2 storage | 2026-04-04 |
| [0008](0008-track-upload-and-identifiers.md) | Track release upload and self-issued identifiers | 2026-04-05 |
| [0009](0009-collection-listings-entitlement.md) | Collection listings and entitlement | 2026-04-05 |
| [0010](0010-staging-environment.md) | Staging deployment environment | 2026-04-05 |
| [0011](0011-app-service-did-and-kid.md) | App service DID and signing key hints | 2026-04-18 |
| [0012](0012-repo-and-identity-resolution.md) | Repo and identity resolution (DID→PDS, handle↔DID) | 2026-08-17 |
| [0013](0013-key-rotation-and-did-document-v2.md) | Key rotation and DID document v2 (`keyHistory`, env-sourced) | 2026-08-30 |
| [0014](0014-merchant-side-key-mirror.md) | Merchant-side storefront key mirror (`actor.merchantKeys`) | 2026-08-30 |
| [0015](0015-storefront-merchant-terminology-split.md) | storefront/merchant terminology split | 2026-09-07 |
| [0016](0016-retire-purchase-consent.md) | Retire `purchase.consent` — freeze license terms on the receipt | 2026-09-11 |
| [0017](0017-permanent-catalog-deletion.md) | Permanent catalog deletion | 2026-09-14 |
| [0018](0018-remove-legacy-record-types.md) | Remove the legacy catalog record types | 2026-09-15 |
| [0019](0019-single-receipt-signature-path.md) | One receipt signature path — fixed payload, no DER fallback | 2026-09-15 |
| [0020](0020-remove-pulumi.md) | Remove Pulumi — provision R2 by hand | 2026-09-16 |
| [0021](0021-remove-fixed-host-fallback.md) | Remove the fixed-host fallback — resolution failure is an error | 2026-09-17 |
| [0022](0022-remove-client-origin-env.md) | Remove `VITE_APP_URL` and `VITE_API_ORIGIN` — the client has no origin to configure | 2026-09-17 |
| [0023](0023-public-cover-art-endpoint.md) | Serve cover art from our own origin for link previews | 2026-09-17 |

Alignment folders not given a dedicated ADR (covered by cross-refs above or out of scope):

- `260402-scaffold-ui` → ADR 0002
- `260403-lexicon-support` → ADR 0003
- `260405-improve-uploads` → ADR 0007, 0008, 0011 (partial)
- `260405-remove-essential` → ADR 0009
