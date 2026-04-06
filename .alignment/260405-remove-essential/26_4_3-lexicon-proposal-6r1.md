# Bazaar — ATProto Commerce Layer: Lexicon Proposal v6

**Date:** 6 April 2026
**Status:** Working proposal, v6 rev.1 — essential flag removed, parentListing added, delivery model corrected, full per-field mutability classification

---

## Changes in v6 rev.1

**Full per-field mutability classification.** Every field across every record now carries an explicit mutability annotation in its description. The summary table has been replaced with a per-record breakdown. Key decisions:

- `bazaarRid`, `bazaarWid`, `bazaarPid` — core identifier fields (`id`, `sig`, `generatedAt`) are immutable once written. The `supersededBy*` fields are the only mutable parts of the `bazaarIdentifier` object, populated when institutional registration is obtained.
- `title` on `catalog.item.digital` — freely mutable.
- `itemClass` on `catalog.item.digital` — immutable. Changing the class of a record is a new publishing act.
- `artistDid` on all records — immutable. Ownership transfer is not a supported operation.
- `collectionType` on `catalog.collection` — freely mutable.
- `parentListing` on `catalog.listing` — immutable once set. Keeping it stable ensures cascade logic is unambiguous.
- `createdAt` on all records — immutable, set at record creation.
- `supersedes` on `catalog.item.digital` — immutable once written, it is a permanent historical pointer.

---

## Changes from v5

### Corrections

**`catalog.collection` items array — `essential` field removed.** The field was misassigned. Its original intent was to indicate which tracks within a collection are available for individual purchase alongside the collection. This intent is already expressed by the existence of an active `catalog.listing` for the item's URI — no flag on the collection record is needed. All items in a collection are always delivered in full on collection purchase. Whether a given item is individually purchasable is determined solely by whether a standalone listing exists for it.

**Purchase and delivery model updated** to reflect the removal of `essential`. Collection purchase always delivers all items. Item-level entitlement via collection ownership is determined by collection membership, not by a flag value.

**Field mutability table** — collection membership row updated to remove reference to the `essential` flag.

**Verification flow** — step 7 updated to remove reference to `essential: true` filtering.

**Known gaps** — removed stale reference to collection mutability affecting `essential` item set.

### Additions

**`catalog.listing#parentListing`** — new optional field. AT-URI of the parent collection listing this standalone item listing is subordinate to. Enables two behaviors: (1) the storefront and merchant dashboard can group and display standalone item listings underneath their parent collection listing; (2) when a collection listing is archived, the backend cascades `status: archived` to all listings where `parentListing` references it. Cascade is a backend convention enforced at archive time — it is not a lexicon constraint. Records are never deleted; receipts referencing archived listings remain valid.

---

## Purchase and delivery model

### Collection purchase → zip delivery

1. Receipt `item.uri` points to the collection record, `item.itemType` is `catalog.collection`
2. Backend resolves the collection and assembles a zip archive of all item files
3. Buyer's library UI surfaces per-item download for every item in the collection — entitlement verified by checking buyer's PDS for a receipt whose `item.uri` resolves to this collection

### Standalone item purchase

1. Receipt `item.uri` points to the `catalog.item.digital` record
2. Backend delivers that item's file directly
3. The item's `collectionUri` is informational — confers no entitlement to other collection items

### Item access via collection ownership

1. Backend receives request for a specific `catalog.item.digital` URI
2. Backend checks buyer's PDS for receipts where `item.itemType = catalog.collection`
3. For each such receipt, backend resolves the collection and checks whether the requested item URI appears in `items`
4. If matched, download is authorized
5. The item's `collectionUri` accelerates step 3 — backend checks that collection first

### Standalone purchasability

Whether a track within a collection is available for individual purchase is determined by the existence of an active `catalog.listing` pointing to that item's URI. Two common patterns:

- **All tracks individually purchasable** — active standalone listings exist for every track in the collection
- **Some tracks individually purchasable** — active standalone listings exist for a subset of tracks; the remainder are only accessible via collection purchase

Standalone listings for collection tracks may carry `parentListing` pointing to the collection listing. The backend cascades `status: archived` to these standalone listings when the parent collection listing is archived.

---

## Field mutability classification

Mutability rules apply to PDS records. "Freely mutable" means `putRecord` is sufficient. "Immutable" means the field must not be changed after the record is written — if the underlying reality changes, a new record is required. "New record required" means the change is a publishing act, not an edit, and must be expressed via the supersedes chain.

### `catalog.item.digital`

| Field                        | Mutability                                           |
| ---------------------------- | ---------------------------------------------------- |
| `title`                      | Freely mutable                                       |
| `artistDid`                  | Immutable                                            |
| `itemClass`                  | Immutable — a class change is a new publishing act   |
| `description`                | Freely mutable                                       |
| `formats`                    | Immutable — new record required via supersedes chain |
| `fileChecksum`               | Immutable — new record required via supersedes chain |
| `fileCid`                    | Immutable — new record required via supersedes chain |
| `fileFormat`                 | Immutable — new record required via supersedes chain |
| `durationMs`                 | Immutable — new record required via supersedes chain |
| `releaseDate`                | Freely mutable                                       |
| `artworkCid`                 | Freely mutable                                       |
| `genre`                      | Freely mutable                                       |
| `isrc`                       | Freely mutable                                       |
| `defaultLicenseUri`          | Freely mutable                                       |
| `bazaarRid.id`               | Immutable                                            |
| `bazaarRid.sig`              | Immutable                                            |
| `bazaarRid.generatedAt`      | Immutable                                            |
| `bazaarRid.supersededByIsrc` | Mutable — populated when ISRC is obtained            |
| `collectionUri`              | Freely mutable                                       |
| `supersedes`                 | Immutable — permanent historical pointer             |
| `createdAt`                  | Immutable                                            |

### `catalog.item.physical`

| Field              | Mutability                                                       |
| ------------------ | ---------------------------------------------------------------- |
| `title`            | Freely mutable                                                   |
| `artistDid`        | Immutable                                                        |
| `itemClass`        | Immutable                                                        |
| `description`      | Freely mutable                                                   |
| `variants`         | Freely mutable — add, remove, or update variants via `putRecord` |
| `artworkCid`       | Freely mutable                                                   |
| `countryOfOrigin`  | Freely mutable                                                   |
| `harmonizedCode`   | Freely mutable                                                   |
| `requiresShipping` | Freely mutable                                                   |
| `createdAt`        | Immutable                                                        |

### `catalog.item.bundle`

| Field         | Mutability                                               |
| ------------- | -------------------------------------------------------- |
| `title`       | Freely mutable                                           |
| `artistDid`   | Immutable                                                |
| `description` | Freely mutable                                           |
| `items`       | Freely mutable — add or remove item refs via `putRecord` |
| `artworkCid`  | Freely mutable                                           |
| `createdAt`   | Immutable                                                |

### `catalog.collection`

| Field                       | Mutability                                     |
| --------------------------- | ---------------------------------------------- |
| `title`                     | Freely mutable                                 |
| `artistDid`                 | Immutable                                      |
| `collectionType`            | Freely mutable                                 |
| `description`               | Freely mutable                                 |
| `releaseDate`               | Freely mutable                                 |
| `items[].uri`               | Freely mutable — items may be added or removed |
| `items[].cid`               | Freely mutable                                 |
| `items[].role`              | Freely mutable                                 |
| `items[].trackNumber`       | Freely mutable                                 |
| `items[].discNumber`        | Freely mutable                                 |
| `items[].title`             | Freely mutable                                 |
| `defaultLicenseUri`         | Freely mutable                                 |
| `upc`                       | Freely mutable                                 |
| `bazaarPid.id`              | Immutable                                      |
| `bazaarPid.sig`             | Immutable                                      |
| `bazaarPid.generatedAt`     | Immutable                                      |
| `bazaarPid.supersededByUpc` | Mutable — populated when UPC is obtained       |
| `artworkCid`                | Freely mutable                                 |
| `genre`                     | Freely mutable                                 |
| `createdAt`                 | Immutable                                      |

### `catalog.listing`

| Field                  | Mutability                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `item`                 | Immutable — a listing is for a specific item; a different item requires a new listing                               |
| `price`                | Immutable — material change requires new listing record with `status: superseded` on the old                        |
| `compareAtPrice`       | Freely mutable                                                                                                      |
| `status`               | Mutable — `active` ↔ `paused`, `soldOut`, `scheduled` may update in place; `archived` and `superseded` are terminal |
| `licenseUri`           | Immutable — license change requires new listing record                                                              |
| `licenseGrantCid`      | Immutable                                                                                                           |
| `parentListing`        | Immutable once set                                                                                                  |
| `supersededBy`         | Immutable once set — populated when this listing is superseded                                                      |
| `availableFrom`        | Freely mutable                                                                                                      |
| `availableUntil`       | Freely mutable                                                                                                      |
| `maxPurchasesPerBuyer` | Freely mutable                                                                                                      |
| `createdAt`            | Immutable                                                                                                           |

### `catalog.recording`

| Field                        | Mutability                                         |
| ---------------------------- | -------------------------------------------------- |
| `itemUri`                    | Immutable — anchors this record to a specific item |
| `itemCid`                    | Immutable                                          |
| `isrc`                       | Freely mutable                                     |
| `iswc`                       | Freely mutable                                     |
| `bazaarRid.id`               | Immutable                                          |
| `bazaarRid.sig`              | Immutable                                          |
| `bazaarRid.generatedAt`      | Immutable                                          |
| `bazaarRid.supersededByIsrc` | Mutable — populated when ISRC is obtained          |
| `bazaarWid.id`               | Immutable                                          |
| `bazaarWid.sig`              | Immutable                                          |
| `bazaarWid.generatedAt`      | Immutable                                          |
| `bazaarWid.supersededByIswc` | Mutable — populated when ISWC is obtained          |
| `recordingMetaUri`           | Freely mutable                                     |
| `songMetaUri`                | Freely mutable                                     |
| `masterOwnerDid`             | Freely mutable                                     |
| `publishingOwnerDid`         | Freely mutable                                     |
| `publishingOwnerIpi`         | Freely mutable                                     |
| `masterLicenseTermsUri`      | Freely mutable                                     |
| `publishingLicenseTermsUri`  | Freely mutable                                     |
| `createdAt`                  | Immutable                                          |

### `catalog.composition`

| Field                        | Mutability                                |
| ---------------------------- | ----------------------------------------- |
| `title`                      | Freely mutable                            |
| `artistDid`                  | Immutable                                 |
| `iswc`                       | Freely mutable                            |
| `bazaarWid.id`               | Immutable                                 |
| `bazaarWid.sig`              | Immutable                                 |
| `bazaarWid.generatedAt`      | Immutable                                 |
| `bazaarWid.supersededByIswc` | Mutable — populated when ISWC is obtained |
| `writers`                    | Freely mutable                            |
| `publishers`                 | Freely mutable                            |
| `proRegistrations`           | Freely mutable                            |
| `publishingLicenseTermsUri`  | Freely mutable                            |
| `songMetaUri`                | Freely mutable                            |
| `recordings`                 | Freely mutable                            |
| `copyrightYear`              | Freely mutable                            |
| `copyrightRegistrationId`    | Freely mutable                            |
| `createdAt`                  | Immutable                                 |

### `license.terms`

| Field                     | Mutability     |
| ------------------------- | -------------- |
| `title`                   | Freely mutable |
| `tier`                    | Freely mutable |
| `rightsType`              | Freely mutable |
| `version`                 | Freely mutable |
| `territoryCoverage`       | Freely mutable |
| `term`                    | Freely mutable |
| `usageRestrictions`       | Freely mutable |
| `proNotice`               | Freely mutable |
| `legalMetadata`           | Freely mutable |
| `humanReadableUrl`        | Freely mutable |
| `summary`                 | Freely mutable |
| `editionSize`             | Freely mutable |
| `checkoutConsentRequired` | Freely mutable |
| `createdAt`               | Immutable      |

Note: `license.terms` records are freely mutable via `putRecord`, but listings and receipts capture a CID snapshot (`licenseGrantCid`) at the moment of listing creation and purchase. Updating a `license.terms` record does not affect any existing receipt or listing that has already captured a CID. To offer new terms on a listing, create a new `license.terms` record and supersede the listing.

### `purchase.receipt`

All fields immutable. Written once by the app service keypair at purchase time. Lives on the buyer's PDS — the artist cannot mutate it.

### `purchase.consent`

All fields immutable. Written once by the app service keypair at checkout. Lives on the buyer's PDS.

### `purchase.stock`

| Field               | Mutability                                               |
| ------------------- | -------------------------------------------------------- |
| `itemUri`           | Immutable                                                |
| `itemCid`           | Immutable                                                |
| `variantSku`        | Immutable                                                |
| `quantityAvailable` | Freely mutable — updated by the backend as stock changes |
| `quantityReserved`  | Freely mutable                                           |
| `quantitySold`      | Freely mutable                                           |
| `isUnlimited`       | Freely mutable                                           |
| `lowStockThreshold` | Freely mutable                                           |
| `updatedAt`         | Freely mutable — updated with every stock change         |

### `purchase.fulfillment`

| Field               | Mutability                                                   |
| ------------------- | ------------------------------------------------------------ |
| `receiptUri`        | Immutable                                                    |
| `receiptCid`        | Immutable                                                    |
| `status`            | Freely mutable — this is a living logistics record           |
| `carrier`           | Freely mutable                                               |
| `trackingNumber`    | Freely mutable                                               |
| `trackingUrl`       | Freely mutable                                               |
| `estimatedDelivery` | Freely mutable                                               |
| `shippedAt`         | Freely mutable                                               |
| `deliveredAt`       | Freely mutable                                               |
| `events`            | Freely mutable — append-only by convention, but not enforced |
| `createdAt`         | Immutable                                                    |
| `updatedAt`         | Freely mutable                                               |

### `actor.merchant`

| Field           | Mutability     |
| --------------- | -------------- |
| `displayName`   | Freely mutable |
| `description`   | Freely mutable |
| `storefrontUrl` | Freely mutable |
| `avatarCid`     | Freely mutable |
| `bannerCid`     | Freely mutable |
| `createdAt`     | Immutable      |

---

## Namespace

All records live under `diamonds.whereditgo.bazaar.*`
Authority host: `bazaar.whereditgo.diamonds`

---

## Lexicons

---

### `diamonds.whereditgo.bazaar.defs`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.defs",
  "defs": {
    "money": {
      "type": "object",
      "required": ["amount", "currency"],
      "properties": {
        "amount": {
          "type": "integer",
          "description": "Smallest currency unit (cents, pence, etc.)"
        },
        "currency": {
          "type": "string",
          "maxLength": 3,
          "description": "ISO 4217 code, e.g. USD"
        }
      }
    },
    "dimensions": {
      "type": "object",
      "required": ["unit"],
      "properties": {
        "width": { "type": "number" },
        "height": { "type": "number" },
        "depth": { "type": "number" },
        "unit": { "type": "string", "knownValues": ["mm", "cm", "in"] }
      }
    },
    "weight": {
      "type": "object",
      "required": ["value", "unit"],
      "properties": {
        "value": { "type": "number" },
        "unit": { "type": "string", "knownValues": ["g", "kg", "oz", "lb"] }
      }
    },
    "variant": {
      "type": "object",
      "description": "A specific purchasable configuration of a physical item.",
      "required": ["sku"],
      "properties": {
        "sku": { "type": "string", "maxLength": 128 },
        "attributes": {
          "type": "object",
          "description": "Freeform key-value map. Common keys: size, color, material, edition."
        },
        "weight": { "$ref": "diamonds.whereditgo.bazaar.defs#weight" },
        "dimensions": { "$ref": "diamonds.whereditgo.bazaar.defs#dimensions" },
        "additionalPrice": { "$ref": "diamonds.whereditgo.bazaar.defs#money" },
        "artworkCid": { "type": "string", "format": "cid" }
      }
    },
    "itemRef": {
      "type": "object",
      "required": ["uri", "itemType"],
      "properties": {
        "uri": { "type": "string", "format": "at-uri" },
        "cid": { "type": "string", "format": "cid" },
        "variantSku": {
          "type": "string",
          "description": "For physical items: which variant was purchased."
        },
        "itemType": {
          "type": "string",
          "knownValues": [
            "diamonds.whereditgo.bazaar.catalog.item.digital",
            "diamonds.whereditgo.bazaar.catalog.item.physical",
            "diamonds.whereditgo.bazaar.catalog.item.bundle",
            "diamonds.whereditgo.bazaar.catalog.collection"
          ]
        }
      }
    },
    "address": {
      "type": "object",
      "required": ["line1", "city", "countryCode"],
      "properties": {
        "line1": { "type": "string", "maxLength": 256 },
        "line2": { "type": "string", "maxLength": 256 },
        "city": { "type": "string", "maxLength": 128 },
        "region": { "type": "string", "maxLength": 128 },
        "postalCode": { "type": "string", "maxLength": 32 },
        "countryCode": {
          "type": "string",
          "maxLength": 2,
          "description": "ISO 3166-1 alpha-2"
        }
      }
    },
    "territoryCoverage": {
      "type": "object",
      "required": ["scope"],
      "properties": {
        "scope": {
          "type": "string",
          "knownValues": ["worldwide", "excluding", "only"]
        },
        "territories": {
          "type": "array",
          "items": { "type": "string", "maxLength": 2 },
          "description": "ISO 3166-1 alpha-2 codes. Interpreted per scope."
        }
      }
    },
    "bazaarIdentifier": {
      "type": "object",
      "description": "A self-issued, cryptographically signed identifier generated by the artist's backend at upload time. Serves as a non-colliding, ownership-evidentiary stand-in for institutional identifiers (ISRC, ISWC, UPC) until formal registration is obtained. Generated as base32(SHA-256(canonicalPayload)) where the payload always includes the artist's DID, ensuring global uniqueness without a registry. Signed by the artist's ATProto keypair — verifiable by resolving the artist's DID document. Mutability: id, sig, and generatedAt are immutable once written — mutating them destroys the evidentiary value of the assertion. The supersededBy* fields are the only mutable parts, populated when institutional registration is obtained.",
      "required": ["id", "sig", "generatedAt"],
      "properties": {
        "id": {
          "type": "string",
          "description": "The self-issued identifier. Prefixed by type: bazaar:rid:* for recordings, bazaar:wid:* for works/compositions, bazaar:pid:* for products/releases."
        },
        "sig": {
          "type": "string",
          "description": "Base64url signature by the artist's ATProto keypair over the canonical identifier payload. Verifiable by resolving the artist's DID document to obtain the public key."
        },
        "generatedAt": {
          "type": "string",
          "format": "datetime",
          "description": "Timestamp of identifier generation. Combined with the PDS record's creation timestamp forms a tamper-evident assertion of when ownership was first claimed."
        },
        "supersededByIsrc": {
          "type": "string",
          "maxLength": 16,
          "description": "Populated when a proper ISRC is obtained. The bazaar:rid remains valid as the historical assertion record."
        },
        "supersededByIswc": {
          "type": "string",
          "maxLength": 16,
          "description": "Populated when a proper ISWC is obtained. The bazaar:wid remains valid as the historical assertion record."
        },
        "supersededByUpc": {
          "type": "string",
          "maxLength": 20,
          "description": "Populated when a proper UPC is obtained. The bazaar:pid remains valid as the historical assertion record."
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.item.digital`

Unchanged from v5.

**Mutability note:** See field mutability classification table. File identity fields (`formats`, `fileChecksum`, `fileCid`, `fileFormat`, `durationMs`) require a new record via the supersedes chain. `bazaarRid` core fields (`id`, `sig`, `generatedAt`) are immutable; `supersededByIsrc` is the only mutable part. All other fields are freely mutable except `artistDid`, `itemClass`, `supersedes`, and `createdAt` which are immutable.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.item.digital",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "title",
          "artistDid",
          "itemClass",
          "formats",
          "fileChecksum",
          "fileCid",
          "createdAt"
        ],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 512,
            "description": "Freely mutable."
          },
          "artistDid": {
            "type": "string",
            "format": "did",
            "description": "Immutable. Ownership transfer is not a supported operation."
          },
          "itemClass": {
            "type": "string",
            "knownValues": [
              "track",
              "album",
              "samplePack",
              "preset",
              "stems",
              "video",
              "document",
              "ebook",
              "other"
            ],
            "description": "Immutable. A class change is a new publishing act requiring a new record."
          },
          "description": {
            "type": "string",
            "maxLength": 4096,
            "description": "Freely mutable."
          },
          "formats": {
            "type": "array",
            "items": { "type": "string", "maxLength": 32 },
            "minLength": 1,
            "description": "e.g. flac, mp3-320, wav, pdf. Immutable — new record required via supersedes chain if changed."
          },
          "fileChecksum": {
            "type": "string",
            "maxLength": 64,
            "description": "SHA-256 hex digest computed server-side from the received file bytes before S3 write. Verifiable by any standard tooling without ATProto context. Immutable — new record required via supersedes chain if changed."
          },
          "fileCid": {
            "type": "string",
            "format": "cid",
            "description": "IPLD CID computed by the backend from the file content locally, not derived from any PDS operation. Content-addressed reference used for integrity verification. Immutable — new record required via supersedes chain if changed."
          },
          "fileFormat": {
            "type": "string",
            "maxLength": 128,
            "description": "MIME type of the uploaded source file, e.g. audio/flac, application/pdf, video/mp4. Immutable — new record required via supersedes chain if changed."
          },
          "durationMs": {
            "type": "integer",
            "description": "Duration in milliseconds, read from file metadata at upload time. Only populated for time-based media (audio, video). Omit for documents, artwork, and other non-time-based itemClass values. Immutable — new record required via supersedes chain if changed."
          },
          "releaseDate": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "artworkCid": {
            "type": "string",
            "format": "cid",
            "description": "Freely mutable."
          },
          "genre": {
            "type": "array",
            "items": { "type": "string", "maxLength": 64 },
            "description": "Freely mutable."
          },
          "isrc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Recording Code. Optional — may be absent if not yet registered. See bazaarRid for self-issued alternative. Freely mutable."
          },
          "defaultLicenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the default license.terms record for this item. Used to pre-populate the listing form. Not the authoritative license at point of sale — the listing's licenseUri field is authoritative. Freely mutable."
          },
          "bazaarRid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Recording Identifier. Generated as base32(SHA-256(artistDid + fileCid + fileChecksum + createdAt)). Shadows ISRC. id, sig, and generatedAt are immutable. supersededByIsrc is mutable — populated when a proper ISRC is obtained."
          },
          "collectionUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the catalog.collection this item belongs to. Informs storefront display and delivery entitlement checks for collection owners. Optional. Freely mutable."
          },
          "supersedes": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the previous version of this item record. Present only when this record was created to replace an earlier version. Forms a resolvable version chain. The superseded record is never deleted. Immutable once written."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.item.physical`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.item.physical",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "title",
          "artistDid",
          "itemClass",
          "variants",
          "createdAt"
        ],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 512,
            "description": "Freely mutable."
          },
          "artistDid": {
            "type": "string",
            "format": "did",
            "description": "Immutable."
          },
          "itemClass": {
            "type": "string",
            "knownValues": [
              "clothing",
              "vinyl",
              "cd",
              "cassette",
              "poster",
              "print",
              "accessory",
              "hardGood",
              "other"
            ],
            "description": "Immutable."
          },
          "description": {
            "type": "string",
            "maxLength": 4096,
            "description": "Freely mutable."
          },
          "variants": {
            "type": "array",
            "items": { "$ref": "diamonds.whereditgo.bazaar.defs#variant" },
            "minLength": 1,
            "description": "Freely mutable — add, remove, or update variants via putRecord."
          },
          "artworkCid": {
            "type": "string",
            "format": "cid",
            "description": "Freely mutable."
          },
          "countryOfOrigin": {
            "type": "string",
            "maxLength": 2,
            "description": "Freely mutable."
          },
          "harmonizedCode": {
            "type": "string",
            "maxLength": 16,
            "description": "HS tariff code. Freely mutable."
          },
          "requiresShipping": {
            "type": "boolean",
            "default": true,
            "description": "Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.item.bundle`

Unchanged from v5. Commercial convenience grouping only. No product identity, no `bazaarPid`, no `upc`. Not a release.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.item.bundle",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "artistDid", "items", "createdAt"],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 512,
            "description": "Freely mutable."
          },
          "artistDid": {
            "type": "string",
            "format": "did",
            "description": "Immutable."
          },
          "description": {
            "type": "string",
            "maxLength": 4096,
            "description": "Freely mutable."
          },
          "items": {
            "type": "array",
            "items": { "$ref": "diamonds.whereditgo.bazaar.defs#itemRef" },
            "minLength": 2,
            "description": "Freely mutable — add or remove item refs via putRecord."
          },
          "artworkCid": {
            "type": "string",
            "format": "cid",
            "description": "Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.collection`

**Updated in v6.** `essential` field removed from the items array. All items in a collection are always delivered on collection purchase. Standalone purchasability is expressed by the existence of an active `catalog.listing` for the item URI, not by a flag on the collection record.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.collection",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "artistDid", "releaseDate", "items", "createdAt"],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 512,
            "description": "Freely mutable."
          },
          "artistDid": {
            "type": "string",
            "format": "did",
            "description": "Immutable."
          },
          "collectionType": {
            "type": "string",
            "knownValues": ["album", "ep", "single", "compilation", "other"],
            "description": "Freely mutable."
          },
          "description": {
            "type": "string",
            "maxLength": 4096,
            "description": "Optional longer text for the release (e.g. storefront, listings, liner notes)."
          },
          "releaseDate": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "items": {
            "type": "array",
            "minLength": 1,
            "description": "All content belonging to this release, in display order. Freely mutable — items may be added or removed and per-item fields updated via putRecord. Note: receipts reference the collection URI, not a CID snapshot, so entitlement set may shift if items are added or removed after purchase. Snapshot entitlement semantics are deferred.",
            "items": {
              "type": "object",
              "required": ["uri", "role"],
              "properties": {
                "uri": {
                  "type": "string",
                  "format": "at-uri",
                  "description": "AT-URI of the catalog.item.digital record for this content. Freely mutable."
                },
                "cid": {
                  "type": "string",
                  "format": "cid",
                  "description": "Optional CID of the item record at time of collection authoring. Informational only. Freely mutable."
                },
                "role": {
                  "type": "string",
                  "knownValues": [
                    "track",
                    "video",
                    "document",
                    "artwork",
                    "bonus",
                    "other"
                  ],
                  "description": "The function of this item within the release. track = music recording. document = liner notes, lyrics, zine, PDF. video = music video or visual album component. artwork = supplementary visual asset. bonus = promotional or discretionary extra. Freely mutable."
                },
                "trackNumber": {
                  "type": "integer",
                  "description": "Position in the tracklist. Meaningful only for role: track. Freely mutable."
                },
                "discNumber": {
                  "type": "integer",
                  "description": "Disc number for multi-disc releases. Meaningful only for role: track. Freely mutable."
                },
                "title": {
                  "type": "string",
                  "maxLength": 512,
                  "description": "Display title override for this item's role in the collection. Falls back to the item record's own title if absent. Freely mutable."
                }
              }
            }
          },
          "defaultLicenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the default license.terms record for this collection. Used to pre-populate the listing form. Not the authoritative license at point of sale — the listing's licenseUri field is authoritative. Freely mutable."
          },
          "upc": {
            "type": "string",
            "maxLength": 20,
            "description": "Universal Product Code. Optional — may be absent if not yet registered. See bazaarPid for self-issued alternative. Freely mutable."
          },
          "bazaarPid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Product Identifier. Generated as base32(SHA-256(artistDid + collectionUri + releaseDate)). Shadows UPC. id, sig, and generatedAt are immutable. supersededByUpc is mutable — populated when a proper UPC is obtained."
          },
          "artworkCid": {
            "type": "string",
            "format": "cid",
            "description": "Freely mutable."
          },
          "genre": {
            "type": "array",
            "items": { "type": "string", "maxLength": 64 },
            "description": "Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.listing`

**Updated in v6.** Adds optional `parentListing` field. When set, this listing is subordinate to the referenced collection listing for display grouping and status cascade purposes. When the parent listing is archived, the backend sets `status: archived` on all listings referencing it via `parentListing`. Records are never deleted — receipts referencing archived listings remain valid.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.listing",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "item",
          "price",
          "status",
          "licenseUri",
          "licenseGrantCid",
          "createdAt"
        ],
        "properties": {
          "item": {
            "$ref": "diamonds.whereditgo.bazaar.defs#itemRef",
            "description": "Immutable. A listing is for a specific item; a different item requires a new listing."
          },
          "price": {
            "$ref": "diamonds.whereditgo.bazaar.defs#money",
            "description": "Immutable. A price change requires a new listing record with status: superseded on the old one."
          },
          "compareAtPrice": {
            "$ref": "diamonds.whereditgo.bazaar.defs#money",
            "description": "Freely mutable."
          },
          "status": {
            "type": "string",
            "knownValues": [
              "active",
              "paused",
              "soldOut",
              "scheduled",
              "archived",
              "superseded"
            ],
            "description": "Mutable. active ↔ paused, soldOut, and scheduled may update in place. archived and superseded are terminal states."
          },
          "licenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record governing this listing. Required. Takes precedence over defaultLicenseUri on the item or collection. Different listings for the same item may reference different license.terms records, enabling per-tier pricing (e.g. personal vs. commercial). Immutable — a license change requires a new listing record."
          },
          "licenseGrantCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the license.terms record at time of listing creation. Anchors the offered terms so that receipt and consent record resolution is consistent even if the license.terms record is later updated. Immutable."
          },
          "parentListing": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the parent collection listing this standalone item listing is subordinate to. When set, the storefront and merchant dashboard group this listing under the parent. When the parent listing is archived, the backend cascades status: archived to all listings referencing it via this field. Cascade is a backend convention — records are never deleted and existing receipts remain valid. Immutable once set."
          },
          "supersededBy": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the listing record that replaced this one following a material change. Set when status is superseded. Immutable once set."
          },
          "availableFrom": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "availableUntil": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "maxPurchasesPerBuyer": {
            "type": "integer",
            "description": "Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.recording`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.recording",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["itemUri", "itemCid", "createdAt"],
        "properties": {
          "itemUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Immutable. Anchors this record to a specific item."
          },
          "itemCid": {
            "type": "string",
            "format": "cid",
            "description": "Immutable."
          },
          "isrc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Recording Code. Optional — see bazaarRid for self-issued alternative. Freely mutable."
          },
          "iswc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Musical Work Code. Optional — see bazaarWid for self-issued alternative. Freely mutable."
          },
          "bazaarRid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Recording Identifier. Generated as base32(SHA-256(artistDid + fileCid + fileChecksum + createdAt)). Shadows ISRC. id, sig, and generatedAt are immutable. supersededByIsrc is mutable — populated when a proper ISRC is obtained."
          },
          "bazaarWid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Work Identifier. Generated as base32(SHA-256(artistDid + compositionTitle + writers[] + createdAt)). Shadows ISWC. id, sig, and generatedAt are immutable. supersededByIswc is mutable — populated when a proper ISWC is obtained."
          },
          "recordingMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a recording record in an external namespace (e.g. ch.indiemusi.alpha.recording). Freely mutable."
          },
          "songMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a composition record — either in an external namespace (e.g. ch.indiemusi.alpha.song) or a Bazaar-native catalog.composition record. Freely mutable."
          },
          "masterOwnerDid": {
            "type": "string",
            "format": "did",
            "description": "Freely mutable."
          },
          "publishingOwnerDid": {
            "type": "string",
            "format": "did",
            "description": "Freely mutable."
          },
          "publishingOwnerIpi": {
            "type": "string",
            "maxLength": 32,
            "description": "Freely mutable."
          },
          "masterLicenseTermsUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Freely mutable."
          },
          "publishingLicenseTermsUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.composition`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.catalog.composition",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "artistDid", "createdAt"],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 512,
            "description": "Title of the composition. May differ from the recording title. Freely mutable."
          },
          "artistDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the artist publishing this record. Not necessarily the sole writer. Immutable."
          },
          "iswc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Musical Work Code. Assigned by a PRO. Optional — see bazaarWid for self-issued alternative. Freely mutable."
          },
          "bazaarWid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Work Identifier. Generated as base32(SHA-256(artistDid + compositionTitle + writers[] + createdAt)). Writers array canonicalized before hashing. Shadows ISWC. id, sig, and generatedAt are immutable. supersededByIswc is mutable — populated when a proper ISWC is obtained."
          },
          "writers": {
            "type": "array",
            "description": "Co-writers and their share splits. Optional — single-writer compositions may omit. Freely mutable.",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string", "maxLength": 256 },
                "ipi": {
                  "type": "string",
                  "maxLength": 32,
                  "description": "Interested Parties Information number. Assigned by a PRO."
                },
                "did": {
                  "type": "string",
                  "format": "did",
                  "description": "ATProto DID of this writer if they have one. Optional."
                },
                "share": {
                  "type": "number",
                  "description": "Percentage of the composition. All shares should sum to 100."
                },
                "role": {
                  "type": "string",
                  "knownValues": [
                    "composer",
                    "lyricist",
                    "composerLyricist",
                    "arranger",
                    "adapter"
                  ]
                }
              }
            }
          },
          "publishers": {
            "type": "array",
            "description": "Publishing administrators for this composition. Freely mutable.",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string", "maxLength": 256 },
                "ipi": { "type": "string", "maxLength": 32 },
                "did": { "type": "string", "format": "did" },
                "pro": {
                  "type": "string",
                  "maxLength": 128,
                  "description": "PRO administering this publisher's share, e.g. ASCAP, BMI, SESAC, PRS."
                },
                "share": { "type": "number" }
              }
            }
          },
          "proRegistrations": {
            "type": "array",
            "description": "PRO registrations for this composition across territories. Freely mutable.",
            "items": {
              "type": "object",
              "required": ["pro"],
              "properties": {
                "pro": { "type": "string", "maxLength": 128 },
                "registrationId": { "type": "string", "maxLength": 128 },
                "territory": {
                  "type": "string",
                  "maxLength": 2,
                  "description": "ISO 3166-1 alpha-2. Omit for worldwide registration."
                }
              }
            }
          },
          "publishingLicenseTermsUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record governing publishing rights for this composition. Freely mutable."
          },
          "songMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a song record in an external namespace (e.g. ch.indiemusi.alpha.song). Freely mutable."
          },
          "recordings": {
            "type": "array",
            "description": "AT-URIs of catalog.item.digital records that are recordings of this composition. Informational only — the authoritative link direction is catalog.recording → catalog.composition via songMetaUri. Freely mutable.",
            "items": {
              "type": "object",
              "required": ["uri"],
              "properties": {
                "uri": { "type": "string", "format": "at-uri" },
                "cid": { "type": "string", "format": "cid" }
              }
            }
          },
          "copyrightYear": {
            "type": "integer",
            "description": "Freely mutable."
          },
          "copyrightRegistrationId": {
            "type": "string",
            "maxLength": 128,
            "description": "Copyright office registration ID if registered, e.g. US Copyright Office PA number. Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.license.terms`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.license.terms",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "title",
          "tier",
          "rightsType",
          "version",
          "territoryCoverage",
          "checkoutConsentRequired",
          "createdAt"
        ],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 256,
            "description": "Freely mutable."
          },
          "tier": {
            "type": "string",
            "knownValues": [
              "personal",
              "commercial",
              "syncMaster",
              "syncPublishing",
              "syncFull",
              "mechanical",
              "broadcast",
              "stemLicense"
            ],
            "description": "Freely mutable."
          },
          "rightsType": {
            "type": "string",
            "knownValues": ["master", "publishing", "both"],
            "description": "Which rights stack this license covers. Master = the recording. Publishing = the composition. Both = full clearance. Freely mutable."
          },
          "version": {
            "type": "string",
            "maxLength": 32,
            "description": "Freely mutable."
          },
          "territoryCoverage": {
            "$ref": "diamonds.whereditgo.bazaar.defs#territoryCoverage",
            "description": "Freely mutable."
          },
          "term": {
            "type": "object",
            "description": "Duration of the license. Absent = perpetual. Freely mutable.",
            "properties": {
              "durationMonths": { "type": "integer" },
              "expiresAt": { "type": "string", "format": "datetime" }
            }
          },
          "usageRestrictions": {
            "type": "object",
            "description": "Freely mutable.",
            "properties": {
              "allowsStreaming": { "type": "boolean" },
              "allowsDownload": { "type": "boolean" },
              "allowsCommercialUse": { "type": "boolean" },
              "allowsDerivatives": { "type": "boolean" },
              "allowsSync": { "type": "boolean" },
              "allowsBroadcast": { "type": "boolean" },
              "requiresAttribution": { "type": "boolean" },
              "requiresMechanicalReporting": { "type": "boolean" },
              "requiresShareAlike": {
                "type": "boolean",
                "description": "If true, derivative works must be released under the same license terms as this work. Required for Creative Commons ShareAlike variants (CC BY-SA, CC BY-NC-SA). Absent or false means no share-alike obligation."
              }
            }
          },
          "proNotice": {
            "type": "object",
            "description": "Identifies PRO(s) administering composition rights so buyers know where to direct royalty payments. Freely mutable.",
            "properties": {
              "compositionPro": { "type": "string", "maxLength": 128 },
              "publishingOwnerIpi": { "type": "string", "maxLength": 32 },
              "masterOwnerDid": { "type": "string", "format": "did" }
            }
          },
          "legalMetadata": {
            "type": "object",
            "description": "Freely mutable.",
            "properties": {
              "governingLaw": { "type": "string", "maxLength": 128 },
              "disputeVenue": { "type": "string", "maxLength": 128 },
              "copyrightRegistrationId": { "type": "string", "maxLength": 128 },
              "copyrightYear": { "type": "integer" },
              "proMembership": { "type": "string", "maxLength": 64 }
            }
          },
          "humanReadableUrl": {
            "type": "string",
            "format": "uri",
            "description": "Canonical URL of the full license text. For Creative Commons licenses, this should be the canonical CC deed URL. Freely mutable."
          },
          "summary": {
            "type": "string",
            "maxLength": 1024,
            "description": "Freely mutable."
          },
          "editionSize": {
            "type": "integer",
            "description": "For limited editions. Absent = open edition. Freely mutable."
          },
          "checkoutConsentRequired": {
            "type": "boolean",
            "default": true,
            "description": "If true, the purchasing application MUST obtain affirmative clickwrap consent before completing the transaction. Set to false for Creative Commons licenses where the grant is public and non-transactional. Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.receipt`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.purchase.receipt",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "item",
          "listingUri",
          "listingCid",
          "pricePaid",
          "paymentProcessor",
          "paymentRef",
          "buyerDid",
          "appDid",
          "issuerScope",
          "appSig",
          "purchasedAt"
        ],
        "properties": {
          "item": {
            "$ref": "diamonds.whereditgo.bazaar.defs#itemRef",
            "description": "Immutable."
          },
          "listingUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Immutable."
          },
          "listingCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the listing at time of purchase — immutable price anchor."
          },
          "pricePaid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#money",
            "description": "Immutable."
          },
          "paymentProcessor": {
            "type": "string",
            "maxLength": 128,
            "description": "Immutable."
          },
          "paymentRef": {
            "type": "string",
            "maxLength": 256,
            "description": "Stripe PaymentIntent ID or equivalent. Independently verifiable via payment processor. Immutable."
          },
          "licenseGrantUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Immutable."
          },
          "licenseGrantCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the license.terms record at time of purchase. Resolved from the listing's licenseGrantCid. Immutable."
          },
          "buyerDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the buyer. Explicit field — previously only implied by appSig payload. Makes receipt queryable by buyer identity and consistent with purchase.consent record. Immutable."
          },
          "shippingAddress": {
            "$ref": "diamonds.whereditgo.bazaar.defs#address",
            "description": "For physical items. Lives in buyer's own PDS — they control this data. Immutable."
          },
          "fulfillmentUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Immutable."
          },
          "appDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the Bazaar app that issued this receipt. Verifiers resolve this to get the public key for appSig verification. Immutable."
          },
          "issuerScope": {
            "type": "string",
            "format": "did",
            "description": "DID of the artist/storefront this receipt was issued under. Immutable."
          },
          "appSig": {
            "type": "string",
            "description": "Base64url signature by the app service keypair over SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid). Immutable."
          },
          "purchasedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          },
          "note": {
            "type": "string",
            "maxLength": 512,
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.consent`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.purchase.consent",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "receiptUri",
          "receiptCid",
          "licenseGrantUri",
          "licenseGrantCid",
          "buyerDid",
          "consentedAt",
          "appSig"
        ],
        "properties": {
          "receiptUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the purchase.receipt this consent record accompanies. Immutable."
          },
          "receiptCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the receipt at time of consent. Links consent to a specific, immutable receipt state. Immutable."
          },
          "licenseGrantUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record the buyer consented to. Immutable."
          },
          "licenseGrantCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the license.terms record at time of consent. The buyer agreed to these exact terms — not a future or past version. Immutable."
          },
          "buyerDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the buyer. Names the consenting party explicitly, making this a buyer-addressed instrument rather than an anonymous terms snapshot. Immutable."
          },
          "consentedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Timestamp of affirmative consent. Combined with the PDS record's creation timestamp forms a tamper-evident assertion of when consent was given. Immutable."
          },
          "appSig": {
            "type": "string",
            "description": "Base64url signature by the app service keypair over SHA-256(buyerDid:licenseGrantCid:receiptCid:consentedAt). Prevents consent records being fabricated outside the app's trust boundary. Immutable."
          },
          "usageTier": {
            "type": "string",
            "knownValues": ["personal", "commercial", "sync"],
            "description": "The license tier the buyer selected at checkout. Surfaces the buyer's affirmative acknowledgment of which tier applies — redundant with the license.terms tier field but records the buyer's explicit selection. Immutable."
          },
          "syncProject": {
            "type": "string",
            "maxLength": 512,
            "description": "For sync tier only. Human-readable description of the project this license covers, e.g. 'Short film: The Last Train, dir. A. Smith, 2026'. Optional but strongly recommended for sync purchases. Immutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.stock`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.purchase.stock",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": [
          "itemUri",
          "itemCid",
          "variantSku",
          "quantityAvailable",
          "updatedAt"
        ],
        "properties": {
          "itemUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Immutable."
          },
          "itemCid": {
            "type": "string",
            "format": "cid",
            "description": "Immutable."
          },
          "variantSku": {
            "type": "string",
            "maxLength": 128,
            "description": "Immutable."
          },
          "quantityAvailable": {
            "type": "integer",
            "minimum": 0,
            "description": "Freely mutable — updated by the backend as stock changes."
          },
          "quantityReserved": {
            "type": "integer",
            "minimum": 0,
            "description": "Freely mutable."
          },
          "quantitySold": {
            "type": "integer",
            "minimum": 0,
            "description": "Freely mutable."
          },
          "isUnlimited": {
            "type": "boolean",
            "description": "True for digital items or print-on-demand goods. Freely mutable."
          },
          "lowStockThreshold": {
            "type": "integer",
            "description": "Freely mutable."
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable — updated with every stock change."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.fulfillment`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.purchase.fulfillment",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["receiptUri", "receiptCid", "status", "createdAt"],
        "properties": {
          "receiptUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Immutable."
          },
          "receiptCid": {
            "type": "string",
            "format": "cid",
            "description": "Immutable."
          },
          "status": {
            "type": "string",
            "knownValues": [
              "pending",
              "processing",
              "shipped",
              "inTransit",
              "delivered",
              "returned",
              "cancelled"
            ],
            "description": "Freely mutable — this is a living logistics record."
          },
          "carrier": {
            "type": "string",
            "maxLength": 128,
            "description": "Freely mutable."
          },
          "trackingNumber": {
            "type": "string",
            "maxLength": 256,
            "description": "Freely mutable."
          },
          "trackingUrl": {
            "type": "string",
            "format": "uri",
            "description": "Freely mutable."
          },
          "estimatedDelivery": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "shippedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "deliveredAt": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          },
          "events": {
            "type": "array",
            "description": "Freely mutable. Append-only by convention — existing events should not be removed or modified, but this is not enforced by the lexicon.",
            "items": {
              "type": "object",
              "required": ["status", "timestamp"],
              "properties": {
                "status": { "type": "string", "maxLength": 64 },
                "location": { "type": "string", "maxLength": 256 },
                "timestamp": { "type": "string", "format": "datetime" },
                "note": { "type": "string", "maxLength": 512 }
              }
            }
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Freely mutable."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.actor.merchant`

Unchanged from v5.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.actor.merchant",
  "defs": {
    "main": {
      "type": "record",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["displayName"],
        "properties": {
          "displayName": {
            "type": "string",
            "maxLength": 256,
            "description": "Freely mutable."
          },
          "description": {
            "type": "string",
            "maxLength": 2048,
            "description": "Freely mutable."
          },
          "storefrontUrl": {
            "type": "string",
            "format": "uri",
            "description": "Freely mutable."
          },
          "avatarCid": {
            "type": "string",
            "format": "cid",
            "description": "Freely mutable."
          },
          "bannerCid": {
            "type": "string",
            "format": "cid",
            "description": "Freely mutable."
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Immutable."
          }
        }
      }
    }
  }
}
```

---

## Identifier placement summary

| Record                 | `bazaar:rid` | `bazaar:wid` | `bazaar:pid` |
| ---------------------- | ------------ | ------------ | ------------ |
| `catalog.item.digital` | ✓            | —            | —            |
| `catalog.recording`    | ✓            | ✓            | —            |
| `catalog.composition`  | —            | ✓            | —            |
| `catalog.collection`   | —            | —            | ✓            |
| `catalog.item.bundle`  | —            | —            | —            |

---

## Record authorship

| Record                  | Written by               | Lives in     |
| ----------------------- | ------------------------ | ------------ |
| `catalog.item.digital`  | Artist (via app OAuth)   | Artist's PDS |
| `catalog.item.physical` | Artist (via app OAuth)   | Artist's PDS |
| `catalog.item.bundle`   | Artist (via app OAuth)   | Artist's PDS |
| `catalog.collection`    | Artist (via app OAuth)   | Artist's PDS |
| `catalog.listing`       | App (on artist's behalf) | Artist's PDS |
| `catalog.recording`     | Artist (via app OAuth)   | Artist's PDS |
| `catalog.composition`   | Artist (via app OAuth)   | Artist's PDS |
| `license.terms`         | Artist (via app OAuth)   | Artist's PDS |
| `purchase.receipt`      | App service keypair      | Buyer's PDS  |
| `purchase.consent`      | App service keypair      | Buyer's PDS  |
| `purchase.stock`        | App service keypair      | Artist's PDS |
| `purchase.fulfillment`  | App or 3PL               | Artist's PDS |
| `actor.merchant`        | Artist (via app OAuth)   | Artist's PDS |

---

## Verification flow

1. Resolve `appDid` via the AT Protocol DID document to obtain the app's public verification key
2. Reconstruct the canonical payload: `SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)`
3. Verify `appSig` against the payload using the public key
4. Optionally cross-reference `paymentRef` against Stripe to confirm the transaction independently
5. Resolve `licenseGrantUri` + `licenseGrantCid` to confirm the exact license terms in force at time of purchase
6. Resolve the item URI to obtain `fileChecksum` — cross-reference against the file served by the backend to verify storage integrity
7. If `item.itemType` is `catalog.collection`, resolve the collection to enumerate all items covered by this receipt
8. Optionally resolve `bazaarRid` or `bazaarWid` — verify the signature against the artist's DID document public key to confirm the self-issued identifier was generated by the holder of that DID
9. Resolve `purchase.consent` on the buyer's PDS — verify `buyerDid` matches the receipt, `licenseGrantCid` matches, and `appSig` is valid. For commercial and sync tiers, absence of a consent record is a gap in the evidentiary chain.

---

## File replacement flow

Unchanged from v2. File replacement is a publishing act, not an edit. New item record written with `supersedes` pointer. Old record never deleted.

---

## Lexicon serving

Resolution is domain-based. No central registry. Authority host: `bazaar.whereditgo.diamonds`.

```
GET https://bazaar.whereditgo.diamonds/xrpc/com.atproto.lexicon.get
    ?lexicon=diamonds.whereditgo.bazaar.purchase.receipt
```

In the interim, lexicons are managed as JSON files in `packages/shared/src/lexicons/` and served from the Hono app.

---

## Known gaps (carried forward)

- Clickwrap consent event is now recorded on-chain via `purchase.consent`, but clickwrap enforcement remains a UI requirement — the lexicon cannot enforce that the UI presented the terms before writing the consent record
- Copyright ownership must be established off-chain (PRO membership, registration, ISRC/ISWC assignment)
- Tax collection and remittance is entirely off-ledger
- No key rotation or revocation mechanism for `appSig` trust chain
- Self-issued `bazaar:*` identifiers are not court-defensible ownership claims — they are timestamped, signed assertions of priority. Institutional registration remains the standard for legal enforceability
- No exclusive license mechanism — exclusivity cannot currently be expressed as a rights statement, only approximated via `maxPurchasesPerBuyer: 1` on the listing
- Territory enforcement is off-chain — `territoryCoverage` records intent but the checkout flow has no mechanism to verify buyer territory
- `parentListing` cascade is a backend convention — no lexicon constraint prevents a client from archiving a parent listing without cascading to children, or from setting `parentListing` on a listing that points to a non-collection item

## Action items

- **Define completeness score criteria** per `itemClass` before merchant upload form is built. Distinguish immediately-fillable fields from fields requiring external registration. External registration fields surface as a "next steps" checklist, not a score penalty.
- **Licensing UI panel** — implement as an interactive three-state panel per the directive in v5 Changes section. Must be built before the upload form is finalized.

## Explicitly out of scope (unchanged from v1)

- Physical goods upload UI (stub only in current build)
- Buyer ATProto login at checkout
- Download link generation and delivery
- PRO royalty deduction and remittance
- Multi-artist / multi-tenant support
- Mutual verification and attestation (per Hilke's proposal)
- Cover song / mechanical license compliance tooling
- Key rotation and revocation for `appSig`
- i18n and multi-currency beyond USD display
