# Bazaar — ATProto Commerce Layer: Lexicon Proposal v3
**Date:** 3 April 2026
**Status:** Working proposal, v3 — purchasable collections, generalized collection items array, per-item collection back-reference

---

## Changes from v2

**`defs#itemRef`** — `catalog.collection` added as a valid `itemType`. Listings can now reference a collection directly, making collections purchasable.

**`catalog.collection`** — `tracks` array replaced by a generalized `items` array. Each entry carries a `role` (track, video, document, artwork, bonus, other), an `essential` boolean distinguishing core content from supplementary content, an optional display `title` override, and optional `trackNumber`/`discNumber` (meaningful only for role: track). This allows liner notes, videos, zines, and any other media to be first-class members of a release. The field is renamed from `tracks` to `items` — this is a breaking change from v1/v2; no records exist in production yet so this is acceptable.

**`catalog.item.digital`** — adds optional `collectionUri` field. Allows a digital item to declare its canonical home collection. The delivery backend uses this to answer "does this buyer's collection purchase entitle them to download this individual item?" — enabling the per-track download access pattern without requiring the receipt to enumerate every item.

**No changes to:** `defs` (except `itemRef`), `catalog.item.physical`, `catalog.item.bundle`, `catalog.listing`, `catalog.recording`, `license.terms`, `purchase.receipt`, `purchase.stock`, `purchase.fulfillment`, `actor.profile`.

---

## Purchase and delivery model (v3)

### Collection purchase → zip delivery

When a buyer purchases via a collection listing:

1. Receipt `item.uri` points to the collection record, `item.itemType` is `catalog.collection`
2. Backend resolves the collection, finds all items where `essential: true`
3. Backend assembles and delivers a zip archive of all essential item files
4. Buyer's library UI also surfaces a per-track download option for any `essential: true` item — entitlement is verified by checking the buyer's PDS for a receipt whose `item.uri` resolves to this collection

### Standalone track purchase

When a buyer purchases a track that has its own listing:

1. Receipt `item.uri` points to the `catalog.item.digital` record for that track
2. Backend delivers that track's file directly
3. The track's `collectionUri` field is informational — it tells the storefront which album this track belongs to for display purposes, but confers no entitlement to other collection items

### Track access via collection ownership (per-track download)

When a buyer who owns a collection requests an individual track download:

1. Backend receives request for a specific `catalog.item.digital` URI
2. Backend checks buyer's PDS for receipts where `item.itemType = catalog.collection`
3. For each such receipt, backend resolves the collection and checks whether the requested item URI appears in `items` with `essential: true`
4. If matched, download is authorized
5. The track's `collectionUri` field accelerates step 3 — backend can check that one collection first before scanning all collection receipts

### Bonus / non-essential items

Items in a collection with `essential: false` are at the artist's discretion for delivery. The lexicon records their existence and their role; the backend decides whether to include them in the zip, gate them separately, or surface them as a surprise. No lexicon change is needed to support any of these delivery policies.

---

## Field mutability classification (unchanged from v2, collection row added)

| Field category | Examples | Mutability |
|---|---|---|
| Cosmetic metadata | description, artwork, genre, tags | Freely mutable — PDS `putRecord` |
| External identifiers | ISRC, ISWC, PRO affiliation, indiemusi.ch AT-URIs | Freely mutable — PDS `putRecord` |
| Collection membership | Adding/removing items, changing role or essential flag | Freely mutable — PDS `putRecord` on the collection record |
| License terms | `licenseGrantCid`, `defaultLicenseUri` | New `license.terms` record; listing change triggers new listing record |
| File identity | `audioCid`, `audioChecksum`, `audioFormat`, `durationMs` | New `catalog.item.digital` record via supersedes chain |
| Price / availability | `price`, `status`, `availableFrom/Until` | New `catalog.listing` record via supersedes chain for material changes; minor availability toggles may update in place |

Note on collection mutability: because receipts point to the collection URI (not a CID of the collection), the buyer's entitlement set can change if the artist adds or removes items from the collection after purchase. This is intentional and analogous to a streaming library updating an album's tracklist. If strict snapshot entitlements are required in future (e.g. limited edition with fixed contents), the listing's `listingCid` can be used to anchor the collection state at purchase time — but this requires the delivery backend to resolve the historical collection state, which is non-trivial. Deferred.

---

## Namespace

All records live under `diamonds.whereditgo.bazaar.*`
Authority host: `bazaar.whereditgo.diamonds`

---

## Lexicons

---

### `diamonds.whereditgo.bazaar.defs`

**Updated in v3.** `itemRef#itemType` adds `catalog.collection` as a known value.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.defs",
  "defs": {
    "money": {
      "type": "object",
      "required": ["amount", "currency"],
      "properties": {
        "amount": { "type": "integer", "description": "Smallest currency unit (cents, pence, etc.)" },
        "currency": { "type": "string", "maxLength": 3, "description": "ISO 4217 code, e.g. USD" }
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
        "variantSku": { "type": "string", "description": "For physical items: which variant was purchased." },
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
        "countryCode": { "type": "string", "maxLength": 2, "description": "ISO 3166-1 alpha-2" }
      }
    },
    "territoryCoverage": {
      "type": "object",
      "required": ["scope"],
      "properties": {
        "scope": { "type": "string", "knownValues": ["worldwide", "excluding", "only"] },
        "territories": {
          "type": "array",
          "items": { "type": "string", "maxLength": 2 },
          "description": "ISO 3166-1 alpha-2 codes. Interpreted per scope."
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.item.digital`

**Updated in v3.** Adds optional `collectionUri` — declares the canonical collection this item belongs to. Used by the delivery backend to authorize per-track downloads for collection owners.

**Mutability note:** `description`, `artworkCid`, `genre`, `isrc`, `iswc`, `defaultLicenseUri`, `collectionUri`, and external metadata are freely mutable via PDS `putRecord`. Fields marked `[immutable — new record required]` must be changed by writing a new record with `supersedes` pointing to this one.

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
        "required": ["title", "artistDid", "itemClass", "formats", "audioChecksum", "audioCid", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 512 },
          "artistDid": { "type": "string", "format": "did" },
          "itemClass": {
            "type": "string",
            "knownValues": ["track", "album", "samplePack", "preset", "stems", "video", "document", "ebook", "other"]
          },
          "description": { "type": "string", "maxLength": 4096 },
          "formats": {
            "type": "array",
            "items": { "type": "string", "maxLength": 32 },
            "minLength": 1,
            "description": "e.g. flac, mp3-320, wav, pdf. [immutable — new record required if changed]"
          },
          "audioChecksum": {
            "type": "string",
            "maxLength": 64,
            "description": "SHA-256 hex digest of the source file, computed client-side pre-upload. Verifiable by any standard tooling without ATProto context. [immutable — new record required if changed]"
          },
          "audioCid": {
            "type": "string",
            "format": "cid",
            "description": "IPLD CID returned by PDS blob upload. Content-addressed reference to the uploaded blob. [immutable — new record required if changed]"
          },
          "audioFormat": {
            "type": "string",
            "maxLength": 128,
            "description": "MIME type of the uploaded source file, e.g. audio/flac, application/pdf. [immutable — new record required if changed]"
          },
          "durationMs": {
            "type": "integer",
            "description": "Duration in milliseconds, read from file metadata at upload time. Omit for non-time-based items (documents, artwork). [immutable — new record required if changed]"
          },
          "releaseDate": { "type": "string", "format": "datetime" },
          "artworkCid": { "type": "string", "format": "cid" },
          "genre": { "type": "array", "items": { "type": "string", "maxLength": 64 } },
          "isrc": { "type": "string", "maxLength": 16 },
          "iswc": { "type": "string", "maxLength": 16 },
          "defaultLicenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the default license.terms record for standalone purchases of this item."
          },
          "collectionUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the catalog.collection this item belongs to. Informs storefront display (which album is this track on?) and delivery entitlement checks (does a collection owner have access to this individual item?). Optional — items may exist without belonging to a collection."
          },
          "supersedes": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the previous version of this item record. Present only when this record was created to replace an earlier version (e.g. file replaced, format changed). Forms a resolvable version chain. The superseded record is never deleted."
          },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.item.physical`

Unchanged from v2.

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
        "required": ["title", "artistDid", "itemClass", "variants", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 512 },
          "artistDid": { "type": "string", "format": "did" },
          "itemClass": {
            "type": "string",
            "knownValues": ["clothing", "vinyl", "cd", "cassette", "poster", "print", "accessory", "hardGood", "other"]
          },
          "description": { "type": "string", "maxLength": 4096 },
          "variants": {
            "type": "array",
            "items": { "$ref": "diamonds.whereditgo.bazaar.defs#variant" },
            "minLength": 1
          },
          "artworkCid": { "type": "string", "format": "cid" },
          "countryOfOrigin": { "type": "string", "maxLength": 2 },
          "harmonizedCode": { "type": "string", "maxLength": 16, "description": "HS tariff code." },
          "requiresShipping": { "type": "boolean", "default": true },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.item.bundle`

Unchanged from v2.

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
          "title": { "type": "string", "maxLength": 512 },
          "artistDid": { "type": "string", "format": "did" },
          "description": { "type": "string", "maxLength": 4096 },
          "items": {
            "type": "array",
            "items": { "$ref": "diamonds.whereditgo.bazaar.defs#itemRef" },
            "minLength": 2
          },
          "artworkCid": { "type": "string", "format": "cid" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.collection`

**Updated in v3.** `tracks` array replaced by a generalized `items` array. Each entry carries `role`, `essential`, optional display `title`, and optional `trackNumber`/`discNumber`. The collection is now a valid listing target — it is a purchasable artifact. Purchasing a collection entitles the buyer to a zip of all `essential: true` items and per-item download access to those same items.

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
          "title": { "type": "string", "maxLength": 512 },
          "artistDid": { "type": "string", "format": "did" },
          "collectionType": {
            "type": "string",
            "knownValues": ["album", "ep", "single", "compilation", "other"]
          },
          "releaseDate": { "type": "string", "format": "datetime" },
          "items": {
            "type": "array",
            "minLength": 1,
            "description": "All content belonging to this release, in display order. Tracks, documents, videos, artwork, and bonus material are all valid entries.",
            "items": {
              "type": "object",
              "required": ["uri", "role"],
              "properties": {
                "uri": {
                  "type": "string",
                  "format": "at-uri",
                  "description": "AT-URI of the catalog.item.digital record for this content."
                },
                "cid": {
                  "type": "string",
                  "format": "cid",
                  "description": "Optional CID of the item record at time of collection authoring. Informational only — does not gate delivery."
                },
                "role": {
                  "type": "string",
                  "knownValues": ["track", "video", "document", "artwork", "bonus", "other"],
                  "description": "The function of this item within the release. track = music recording. document = liner notes, lyrics, zine, PDF. video = music video, visual album component. artwork = supplementary visual asset. bonus = promotional or discretionary extra. other = anything else."
                },
                "essential": {
                  "type": "boolean",
                  "default": true,
                  "description": "If true, this item is a core component of the release and is included in the collection zip and per-item download entitlement. If false, the item is supplementary — the delivery backend decides whether and how to surface it. Liner notes and all tracks that are not sold separately should be essential: true. Bonus videos and promotional extras are typically essential: false."
                },
                "trackNumber": {
                  "type": "integer",
                  "description": "Position in the tracklist. Meaningful only for role: track. Omit for non-track items."
                },
                "discNumber": {
                  "type": "integer",
                  "description": "Disc number for multi-disc releases. Meaningful only for role: track."
                },
                "title": {
                  "type": "string",
                  "maxLength": 512,
                  "description": "Display title override for this item's role in the collection — e.g. 'Liner Notes', 'Director's Cut', 'Bonus Track'. Falls back to the item record's own title if absent."
                }
              }
            }
          },
          "defaultLicenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record that governs purchases of this collection. Applied to all essential items delivered via collection purchase."
          },
          "artworkCid": { "type": "string", "format": "cid" },
          "genre": { "type": "array", "items": { "type": "string", "maxLength": 64 } },
          "upc": { "type": "string", "maxLength": 20 },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.listing`

Unchanged from v2. Now valid for collections via `itemRef#itemType: catalog.collection`.

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
        "required": ["item", "price", "status", "createdAt"],
        "properties": {
          "item": { "$ref": "diamonds.whereditgo.bazaar.defs#itemRef" },
          "price": { "$ref": "diamonds.whereditgo.bazaar.defs#money" },
          "compareAtPrice": { "$ref": "diamonds.whereditgo.bazaar.defs#money" },
          "status": {
            "type": "string",
            "knownValues": ["active", "paused", "soldOut", "scheduled", "archived", "superseded"]
          },
          "supersededBy": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the listing record that replaced this one following a material change. Set when status is superseded."
          },
          "availableFrom": { "type": "string", "format": "datetime" },
          "availableUntil": { "type": "string", "format": "datetime" },
          "maxPurchasesPerBuyer": { "type": "integer" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.recording`

Unchanged from v2.

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
        "required": ["itemUri", "itemCid", "isrc", "createdAt"],
        "properties": {
          "itemUri": { "type": "string", "format": "at-uri" },
          "itemCid": { "type": "string", "format": "cid" },
          "isrc": { "type": "string", "maxLength": 16 },
          "iswc": { "type": "string", "maxLength": 16 },
          "recordingMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a recording record in an external namespace (e.g. ch.indiemusi.alpha.recording)."
          },
          "songMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a song/composition record in an external namespace."
          },
          "masterOwnerDid": { "type": "string", "format": "did" },
          "publishingOwnerDid": { "type": "string", "format": "did" },
          "publishingOwnerIpi": { "type": "string", "maxLength": 32 },
          "masterLicenseTermsUri": { "type": "string", "format": "at-uri" },
          "publishingLicenseTermsUri": { "type": "string", "format": "at-uri" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.license.terms`

Unchanged from v2.

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
        "required": ["title", "tier", "rightsType", "version", "territoryCoverage", "checkoutConsentRequired", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 256 },
          "tier": {
            "type": "string",
            "knownValues": ["personal", "commercial", "syncMaster", "syncPublishing", "syncFull", "mechanical", "broadcast", "stemLicense"]
          },
          "rightsType": {
            "type": "string",
            "knownValues": ["master", "publishing", "both"],
            "description": "Which rights stack this license covers. Master = the recording. Publishing = the composition. Both = full clearance."
          },
          "version": { "type": "string", "maxLength": 32 },
          "territoryCoverage": { "$ref": "diamonds.whereditgo.bazaar.defs#territoryCoverage" },
          "term": {
            "type": "object",
            "description": "Duration of the license. Absent = perpetual.",
            "properties": {
              "durationMonths": { "type": "integer" },
              "expiresAt": { "type": "string", "format": "datetime" }
            }
          },
          "usageRestrictions": {
            "type": "object",
            "properties": {
              "allowsStreaming": { "type": "boolean" },
              "allowsDownload": { "type": "boolean" },
              "allowsCommercialUse": { "type": "boolean" },
              "allowsDerivatives": { "type": "boolean" },
              "allowsSync": { "type": "boolean" },
              "allowsBroadcast": { "type": "boolean" },
              "requiresAttribution": { "type": "boolean" },
              "requiresMechanicalReporting": { "type": "boolean" }
            }
          },
          "proNotice": {
            "type": "object",
            "description": "Identifies PRO(s) administering composition rights so buyers know where to direct royalty payments.",
            "properties": {
              "compositionPro": { "type": "string", "maxLength": 128 },
              "publishingOwnerIpi": { "type": "string", "maxLength": 32 },
              "masterOwnerDid": { "type": "string", "format": "did" }
            }
          },
          "legalMetadata": {
            "type": "object",
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
            "description": "Canonical URL of the full license text."
          },
          "summary": { "type": "string", "maxLength": 1024 },
          "editionSize": { "type": "integer", "description": "For limited editions. Absent = open edition." },
          "checkoutConsentRequired": {
            "type": "boolean",
            "default": true,
            "description": "If true, the purchasing application MUST obtain affirmative clickwrap consent before completing the transaction."
          },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.receipt`

Unchanged from v2. When a collection is purchased, `item.uri` is the collection AT-URI and `item.itemType` is `catalog.collection`. The receipt's `licenseGrantCid` resolves to the license terms that governed the collection purchase.

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
        "required": ["item", "listingUri", "listingCid", "pricePaid", "paymentProcessor", "paymentRef", "appDid", "issuerScope", "appSig", "purchasedAt"],
        "properties": {
          "item": { "$ref": "diamonds.whereditgo.bazaar.defs#itemRef" },
          "listingUri": { "type": "string", "format": "at-uri" },
          "listingCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the listing at time of purchase — immutable price anchor."
          },
          "pricePaid": { "$ref": "diamonds.whereditgo.bazaar.defs#money" },
          "paymentProcessor": { "type": "string", "maxLength": 128 },
          "paymentRef": {
            "type": "string",
            "maxLength": 256,
            "description": "Stripe PaymentIntent ID or equivalent. Independently verifiable via payment processor."
          },
          "licenseGrantUri": { "type": "string", "format": "at-uri" },
          "licenseGrantCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the license.terms record at time of purchase."
          },
          "shippingAddress": {
            "$ref": "diamonds.whereditgo.bazaar.defs#address",
            "description": "For physical items. Lives in buyer's own PDS — they control this data."
          },
          "fulfillmentUri": { "type": "string", "format": "at-uri" },
          "appDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the Bazaar app that issued this receipt. Verifiers resolve this to get the public key for appSig verification."
          },
          "issuerScope": {
            "type": "string",
            "format": "did",
            "description": "DID of the artist/storefront this receipt was issued under. Enables multi-artist verification without backend contact."
          },
          "appSig": {
            "type": "string",
            "description": "Base64url signature by the app service keypair over SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)."
          },
          "purchasedAt": { "type": "string", "format": "datetime" },
          "note": { "type": "string", "maxLength": 512 }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.stock`

Unchanged from v2.

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
        "required": ["itemUri", "itemCid", "variantSku", "quantityAvailable", "updatedAt"],
        "properties": {
          "itemUri": { "type": "string", "format": "at-uri" },
          "itemCid": { "type": "string", "format": "cid" },
          "variantSku": { "type": "string", "maxLength": 128 },
          "quantityAvailable": { "type": "integer", "minimum": 0 },
          "quantityReserved": { "type": "integer", "minimum": 0 },
          "quantitySold": { "type": "integer", "minimum": 0 },
          "isUnlimited": {
            "type": "boolean",
            "description": "True for digital items or print-on-demand goods."
          },
          "lowStockThreshold": { "type": "integer" },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.fulfillment`

Unchanged from v2.

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
          "receiptUri": { "type": "string", "format": "at-uri" },
          "receiptCid": { "type": "string", "format": "cid" },
          "status": {
            "type": "string",
            "knownValues": ["pending", "processing", "shipped", "inTransit", "delivered", "returned", "cancelled"]
          },
          "carrier": { "type": "string", "maxLength": 128 },
          "trackingNumber": { "type": "string", "maxLength": 256 },
          "trackingUrl": { "type": "string", "format": "uri" },
          "estimatedDelivery": { "type": "string", "format": "datetime" },
          "shippedAt": { "type": "string", "format": "datetime" },
          "deliveredAt": { "type": "string", "format": "datetime" },
          "events": {
            "type": "array",
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
          "createdAt": { "type": "string", "format": "datetime" },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.actor.profile`

Unchanged from v2.

```json
{
  "lexicon": 1,
  "id": "diamonds.whereditgo.bazaar.actor.profile",
  "defs": {
    "main": {
      "type": "record",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["displayName"],
        "properties": {
          "displayName": { "type": "string", "maxLength": 256 },
          "description": { "type": "string", "maxLength": 2048 },
          "storefrontUrl": { "type": "string", "format": "uri" },
          "avatarCid": { "type": "string", "format": "cid" },
          "bannerCid": { "type": "string", "format": "cid" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

## Record authorship

| Record | Written by | Lives in |
|---|---|---|
| `catalog.item.digital` | Artist (via app OAuth) | Artist's PDS |
| `catalog.item.physical` | Artist (via app OAuth) | Artist's PDS |
| `catalog.item.bundle` | Artist (via app OAuth) | Artist's PDS |
| `catalog.collection` | Artist (via app OAuth) | Artist's PDS |
| `catalog.listing` | App (on artist's behalf) | Artist's PDS |
| `catalog.recording` | Artist (via app OAuth) | Artist's PDS |
| `license.terms` | Artist (via app OAuth) | Artist's PDS |
| `purchase.receipt` | App service keypair | Buyer's PDS |
| `purchase.stock` | App service keypair | Artist's PDS |
| `purchase.fulfillment` | App or 3PL | Artist's PDS |
| `actor.profile` | Artist (via app OAuth) | Artist's PDS |

---

## Verification flow

Any third party can verify a `purchase.receipt` without contacting the Bazaar backend:

1. Resolve `appDid` via the AT Protocol DID document to obtain the app's public verification key
2. Reconstruct the canonical payload: `SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)`
3. Verify `appSig` against the payload using the public key
4. Optionally cross-reference `paymentRef` against the payment processor (Stripe) to confirm the transaction independently
5. Resolve `licenseGrantUri` + `licenseGrantCid` to confirm the exact license terms in force at time of purchase
6. *(v2)* Resolve the item URI to obtain `audioChecksum` — cross-reference against the file served by the backend to verify storage integrity
7. *(v3)* If `item.itemType` is `catalog.collection`, resolve the collection to enumerate the full set of `essential: true` items covered by this receipt

---

## Audio file replacement flow

Unchanged from v2. File replacement is a publishing act, not an edit. New item record written with `supersedes` pointer. Old record never deleted.

---

## Lexicon serving

Resolution is domain-based. No central registry. Authority host: `bazaar.whereditgo.diamonds`.

```
GET https://bazaar.whereditgo.diamonds/xrpc/com.atproto.lexicon.get
    ?lexicon=diamonds.whereditgo.bazaar.purchase.receipt
```

In the interim, lexicons are managed as JSON files in `packages/shared` and served from the Hono app.

---

## Known gaps (carried forward, one addition)

- Clickwrap consent is a UI requirement, not a lexicon field — `checkoutConsentRequired` signals this but does not enforce it
- Copyright ownership must be established off-chain (PRO membership, registration, ISRC/ISWC assignment)
- Tax collection and remittance is entirely off-ledger
- No key rotation or revocation mechanism for `appSig` trust chain
- License grant is not addressed to the buyer's DID — `licenseGrantCid` is the terms document, not a signed instrument naming the buyer specifically
- No receipt resolution service to cache item metadata snapshots — dead `itemUri` links erode receipt fidelity if the artist deletes their PDS records
- *(v3 addition)* Collection mutability means a buyer's entitlement set can change if the artist adds or removes essential items after purchase. Receipt points to collection URI, not a CID snapshot of the collection state at purchase time. Snapshot entitlement semantics deferred.

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
