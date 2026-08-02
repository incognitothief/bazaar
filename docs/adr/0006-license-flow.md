# ADR 0006: License terms lifecycle

## Status

Accepted

## Date

2026-04-04

## Context

Bazaar separates **license terms** (what buyers may do) from **listings** (the commercial offer). The listing must anchor the exact `license.terms` CID at creation time so receipts and consent records reference immutable terms. Merchants need to save templates once, reuse them across uploads, and see what is already on their PDS.

## Decision

### 1. Record roles

| Record | Owner repo | Role |
|--------|------------|------|
| `license.terms` | Artist PDS | Reusable legal terms |
| `catalog.listing` | Artist PDS | Price + `licenseUri` + `licenseGrantCid` |
| Item `defaultLicenseUri` | Artist PDS | Form default only; listing fields govern sale |

### 2. Template source

Pre-authored templates live in `packages/shared/src/license-templates/` and export via `@bazaar/shared/license-templates`. `licenseTermsPayloadFromTemplateId` builds a `license.terms` payload for `createRecord`.

`findLicenseByTemplateId` deduplicates: if a repo record matches the template definition (title, version, tier, rights type), reuse its `{ uri, cid }`.

### 3. License page (`/merchant/license`)

- **Saved table** — `listLicenseTermsRows(agent, did)` lists URI, CID, title, tier, version, `createdAt`.
- **Gallery** — complexity-grouped template picker; **Save** calls `createLicenseTerms` or reports existing record; toasts include URI/CID; `onLicensesChanged` refreshes the table.

### 4. Upload license selection

Upload flows (`UploadDigitalPage`, `UploadTracksPage`) use `licensePickMode`:

- **`saved`** — merchant picks a row from `listLicenseTermsRows`; publish uses that `{ uri, cid }` directly for listing fields.
- **`template`** — merchant picks a template id; at publish, `findLicenseByTemplateId` or `createLicenseTerms` resolves `{ uri, cid }` before `createListing`.

CID is unknown in UI state for the template branch until write time; the saved branch carries CID from the table.

### 5. OAuth

Merchant OAuth includes `repo:{ns}.license.terms?action=create` for browser-side `createRecord`. Reads use the public ATProto app view and do not require repo read scopes in the current architecture.

### 6. Downstream consumers

- **Checkout / fulfillment** — listing `licenseGrantCid` flows into `purchase.receipt` and `purchase.consent` (ADR 0004).
- **BuyButton** — clickwrap when `checkoutConsentRequired` is true.
- **Purchase detail** — resolves `licenseGrantUri` for buyer-facing summary.

## Constraints

| Rule | Enforcement |
|------|-------------|
| Listing requires license | `licenseUri` + `licenseGrantCid` on `catalog.listing` |
| No duplicate template saves | `findLicenseByTemplateId` before `createLicenseTerms` |
| Template registry | `@bazaar/shared/license-templates` |

## Consequences

**Positive**

- Terms published once, referenced by CID across listings and purchases.
- Saved-license path avoids redundant `createRecord` at upload time.
- License page makes PDS state visible (URI/CID table).

**Negative / trade-offs**

- Template matching is heuristic (field equality), not template-id stored on record.
- No in-app edit of saved `license.terms` after publish (new record required for material changes).
- Hand-maintained client types must track lexicon changes.

**Deferred**

- `license.terms` update scope and edit UI.
- Server validation of listing CID vs live PDS record at checkout.
