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

Alignment folders not given a dedicated ADR (covered by cross-refs above or out of scope):

- `260402-scaffold-ui` → ADR 0002
- `260403-lexicon-support` → ADR 0003
- `260405-improve-uploads` → ADR 0007, 0008, 0011 (partial)
- `260405-remove-essential` → ADR 0009
