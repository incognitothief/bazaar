# ADR 0007: Digital inventory and R2 storage

## Status

Accepted

## Date

2026-04-04

## Context

Digital catalog files (tracks, artwork) are too large and too numerous for PDS blobs at scale. Bazaar stores bytes in Cloudflare R2 and keeps ATProto records for metadata, licensing, and commerce. Merchants need resumable multi-file uploads and deferred publish so PDS records exist only when uploads and metadata are complete.

## Decision

### 1. Storage split

- **R2** — master audio/files and artwork bytes (private bucket).
- **PDS** — `catalog.item.digital`, `catalog.collection`, `catalog.listing`, etc., created at **publish** time only.
- **SQLite** — upload session state, draft metadata, multipart progress between HTTP requests.

`itemClass` and other catalog taxonomy live in lexicon records only; R2 keys use a fixed `digital` namespace segment.

### 2. R2 object keys

```
inventory/{artistDid}/digital/{itemTid}/{role}
```

Roles include `master` (primary file) and `artwork` (cover). `itemTid` is reserved when the upload object is registered, before publish writes the PDS record.

Server computes `fileChecksum` (SHA-256 hex) and `fileCid` (IPLD) after upload completes. These values populate `catalog.item.digital` at publish.

### 3. Upload session lifecycle

1. Merchant creates `inventory_upload_session` (OAuth cookie → `merchantDid`).
2. Client registers `inventory_upload_object` rows (slot id, reserved `rkey`, `role`, size).
3. Bytes upload via **single PUT** (under multipart threshold) or **S3 multipart** (default threshold 8MB, `BAZAAR_INVENTORY_MULTIPART_MIN_BYTES`).
4. Client saves draft metadata (`draftJson`: titles, collection structure, license, price).
5. `POST …/publish` validates completeness and writes PDS records via server OAuth proxy.

Interrupted sessions can be listed and resumed (multipart parts tracked in `inventory_upload_part`).

### 4. Download entitlement

`GET /api/download?itemUri=…` (buyer session required):

1. List `purchase.receipt` on buyer PDS.
2. Verify `appSig` on candidate receipts.
3. Entitlement: direct `item.uri` match, or collection receipt where the requested digital item URI appears in `collection.items`.
4. Presigned GET (900s) for the `master` key.

`GET /api/download/collection-zip?collectionUri=…` zips all member masters for a purchased collection (size caps enforced).

Public storefront artwork uses presigned reads under `/api/inventory-public/*` (no purchase required).

### 5. Environment

Inventory R2 client: `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.

Diagnostic: `GET /api/inventory/r2-status` (merchant session) for HeadBucket health.

### 6. Expansion hook

`inventory_upload_session.inventoryKind` defaults to `digital`; schema and API names are neutral for future physical inventory without a parallel upload system.

## Constraints

| Rule | Value |
|------|-------|
| Bytes location | R2 only (not PDS blobs for masters) |
| Publish gate | All objects `completed` + valid draft |
| Key builder | `packages/server/src/lib/r2/inventoryKey.ts` |
| Multipart threshold | 8MB default |
| Presign TTL | 900 seconds |

## Consequences

**Positive**

- Large files and batch uploads without PDS blob limits.
- Deferred publish avoids orphan catalog records mid-upload.
- Deterministic keys enable download without a separate bytes index table.

**Negative / trade-offs**

- Server must hold R2 credentials and stream uploads (bandwidth through Fly).
- Collection zip is assembled in memory with size caps.
- Crash between PDS write and session `publishedAt` update may require publish retry (partial idempotency via `pdsSnapshotJson`).

**Deferred**

- Stale multipart sweeper cron beyond client-driven abort.
- Physical goods inventory (`inventoryKind: physical`).
- Phase 2 upload UI polish (plan explicitly deferred rich UX).
