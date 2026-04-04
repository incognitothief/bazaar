# Bazaar — ATProto Commerce Layer: Lexicon Proposal v5
**Date:** 3 April 2026
**Status:** Working proposal, v5 — listing-level license, purchase consent, buyer DID surfacing, ShareAlike, licensing UI directive

---

## Changes from v4

### Corrections

**`catalog.listing`** — adds required `licenseUri` field. The listing is the commercial offer and must explicitly declare the terms under which it is made. This takes precedence over `defaultLicenseUri` on the item. `defaultLicenseUri` on `catalog.item.digital` and `catalog.collection` remains as a convenience default used to pre-populate the listing form, but is not the authoritative license reference at point of sale.

**`purchase.receipt`** — adds explicit `buyerDid` field. The buyer's DID is currently implied by the `appSig` payload but not surfaced as a queryable field on the record. Making it explicit closes the buyer identity gap for receipt-level queries and is consistent with the consent record design.

### Additions

**`purchase.consent`** — new record. Written to the buyer's PDS at checkout alongside the receipt. Records the buyer's affirmative agreement to the specific `licenseGrantCid` at a specific moment. Names the buyer's DID explicitly, making the consent record a named instrument rather than an anonymous terms snapshot. Required for commercial and sync tiers. Recommended for personal use. For sync purchases, carries an optional `syncProject` field describing the intended use.

**`license.terms#usageRestrictions.requiresShareAlike`** — new boolean field. Required for Creative Commons ShareAlike variants (CC BY-SA, CC BY-NC-SA). If true, derivative works must be released under the same license terms as the original.

**Buyer DID audit** — `buyerDid` added as an explicit field to `purchase.receipt` and `purchase.consent`. Any future records representing buyer-specific events (fulfillment updates addressed to a buyer, future consent amendments, sync project declarations) must carry `buyerDid` as an explicit required field.

### Directives

**Licensing UI directive** — the license management interface must be an interactive panel surfacing three distinct states at all times: (1) licenses already saved to the artist's PDS, showing title, tier, rights type, territory, and which items or listings currently reference each one; (2) available templates the platform provides as starting points, clearly distinguished from already-published records; (3) contextual explanation of how licenses work in practice — that a `license.terms` record is published once and reused across listings, that past buyers retain the CID of the terms in effect at purchase regardless of future changes, and that changing a listing's license does not affect existing receipts. This panel is the artist's primary interface for understanding the legal layer of their storefront.

**License is per-listing, not per-item** — the listing is the commercial offer. Different listings for the same item can carry different license terms. The license picker in the upload flow sets `defaultLicenseUri` on the item as a convenience, but the listing creation step must explicitly confirm and record `licenseUri` as its own field. The artist must make a deliberate license selection at listing creation time, not inherit it silently from the item.

---

## Purchase and delivery model (unchanged from v4)

### Collection purchase → zip delivery

1. Receipt `item.uri` points to the collection record, `item.itemType` is `catalog.collection`
2. Backend resolves the collection, finds all items where `essential: true`
3. Backend assembles and delivers a zip archive of all essential item files
4. Buyer's library UI surfaces per-item download for any `essential: true` item — entitlement verified by checking buyer's PDS for a receipt whose `item.uri` resolves to this collection

### Standalone item purchase

1. Receipt `item.uri` points to the `catalog.item.digital` record
2. Backend delivers that item's file directly
3. The item's `collectionUri` is informational — confers no entitlement to other collection items

### Item access via collection ownership

1. Backend receives request for a specific `catalog.item.digital` URI
2. Backend checks buyer's PDS for receipts where `item.itemType = catalog.collection`
3. For each such receipt, backend resolves the collection and checks whether the requested item URI appears in `items` with `essential: true`
4. If matched, download is authorized
5. The item's `collectionUri` accelerates step 3 — backend checks that collection first

### Bonus / non-essential items

Items with `essential: false` are at the artist's discretion for delivery. The lexicon records their existence and role; the backend decides whether and how to surface them.

---

## Field mutability classification

| Field category | Examples | Mutability |
|---|---|---|
| Cosmetic metadata | description, artwork, genre, tags | Freely mutable — PDS `putRecord` |
| External identifiers | ISRC, ISWC, UPC, PRO affiliation, indiemusi.ch AT-URIs | Freely mutable — PDS `putRecord` |
| Self-issued identifiers | `bazaarRid`, `bazaarWid`, `bazaarPid` | Freely mutable — PDS `putRecord` |
| Collection membership | Adding/removing items, role, essential flag | Freely mutable — PDS `putRecord` on collection record |
| License terms | `licenseUri` on listing, `defaultLicenseUri` on item | New `license.terms` record; listing license change triggers new listing record |
| File identity | `fileCid`, `fileChecksum`, `fileFormat`, `durationMs` | New `catalog.item.digital` record via supersedes chain |
| Price / availability | `price`, `status`, `availableFrom/Until` | New `catalog.listing` record for material changes; minor availability toggles may update in place |

---

## Namespace

All records live under `diamonds.whereditgo.bazaar.*`
Authority host: `bazaar.whereditgo.diamonds`

---

## Lexicons

---

### `diamonds.whereditgo.bazaar.defs`

Unchanged from v4.

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
    },
    "bazaarIdentifier": {
      "type": "object",
      "description": "A self-issued, cryptographically signed identifier generated by the artist's backend at upload time. Serves as a non-colliding, ownership-evidentiary stand-in for institutional identifiers (ISRC, ISWC, UPC) until formal registration is obtained. Generated as base32(SHA-256(canonicalPayload)) where the payload always includes the artist's DID, ensuring global uniqueness without a registry. Signed by the artist's ATProto keypair — verifiable by resolving the artist's DID document.",
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

Unchanged from v4.

**Mutability note:** `description`, `artworkCid`, `genre`, `isrc`, `defaultLicenseUri`, `collectionUri`, `bazaarRid`, and external metadata are freely mutable via PDS `putRecord`. Fields marked `[immutable — new record required]` must be changed by writing a new record with `supersedes` pointing to this one.

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
        "required": ["title", "artistDid", "itemClass", "formats", "fileChecksum", "fileCid", "createdAt"],
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
          "fileChecksum": {
            "type": "string",
            "maxLength": 64,
            "description": "SHA-256 hex digest computed server-side from the received file bytes before S3 write. Verifiable by any standard tooling without ATProto context. [immutable — new record required if changed]"
          },
          "fileCid": {
            "type": "string",
            "format": "cid",
            "description": "IPLD CID computed by the backend from the file content locally, not derived from any PDS operation. Content-addressed reference used for integrity verification. [immutable — new record required if changed]"
          },
          "fileFormat": {
            "type": "string",
            "maxLength": 128,
            "description": "MIME type of the uploaded source file, e.g. audio/flac, application/pdf, video/mp4. [immutable — new record required if changed]"
          },
          "durationMs": {
            "type": "integer",
            "description": "Duration in milliseconds, read from file metadata at upload time. Only populated for time-based media (audio, video). Omit for documents, artwork, and other non-time-based itemClass values. [immutable — new record required if changed]"
          },
          "releaseDate": { "type": "string", "format": "datetime" },
          "artworkCid": { "type": "string", "format": "cid" },
          "genre": { "type": "array", "items": { "type": "string", "maxLength": 64 } },
          "isrc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Recording Code. Optional — may be absent if not yet registered. See bazaarRid for self-issued alternative."
          },
          "defaultLicenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the default license.terms record for this item. Used to pre-populate the listing form. Not the authoritative license at point of sale — the listing's licenseUri field is authoritative."
          },
          "bazaarRid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Recording Identifier. Generated as base32(SHA-256(artistDid + fileCid + fileChecksum + createdAt)). Shadows ISRC. supersededByIsrc populated when a proper ISRC is obtained."
          },
          "collectionUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the catalog.collection this item belongs to. Informs storefront display and delivery entitlement checks for collection owners. Optional."
          },
          "supersedes": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the previous version of this item record. Present only when this record was created to replace an earlier version. Forms a resolvable version chain. The superseded record is never deleted."
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

Unchanged from v4.

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

Unchanged from v4. Commercial convenience grouping only. No product identity, no `bazaarPid`, no `upc`. Not a release.

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

Unchanged from v4. The collection is the only release boundary. `defaultLicenseUri` pre-populates the listing form; the listing's `licenseUri` is authoritative at point of sale.

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
            "description": "All content belonging to this release, in display order.",
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
                  "description": "Optional CID of the item record at time of collection authoring. Informational only."
                },
                "role": {
                  "type": "string",
                  "knownValues": ["track", "video", "document", "artwork", "bonus", "other"],
                  "description": "The function of this item within the release. track = music recording. document = liner notes, lyrics, zine, PDF. video = music video or visual album component. artwork = supplementary visual asset. bonus = promotional or discretionary extra."
                },
                "essential": {
                  "type": "boolean",
                  "default": true,
                  "description": "If true, this item is a core component of the release — included in the collection zip and per-item download entitlement. If false, the item is supplementary and delivery is at the backend's discretion."
                },
                "trackNumber": {
                  "type": "integer",
                  "description": "Position in the tracklist. Meaningful only for role: track."
                },
                "discNumber": {
                  "type": "integer",
                  "description": "Disc number for multi-disc releases. Meaningful only for role: track."
                },
                "title": {
                  "type": "string",
                  "maxLength": 512,
                  "description": "Display title override for this item's role in the collection. Falls back to the item record's own title if absent."
                }
              }
            }
          },
          "defaultLicenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the default license.terms record for this collection. Used to pre-populate the listing form. Not the authoritative license at point of sale — the listing's licenseUri field is authoritative."
          },
          "upc": {
            "type": "string",
            "maxLength": 20,
            "description": "Universal Product Code. Optional — may be absent if not yet registered. See bazaarPid for self-issued alternative."
          },
          "bazaarPid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Product Identifier. Generated as base32(SHA-256(artistDid + collectionUri + releaseDate)). Shadows UPC. supersededByUpc populated when a proper UPC is obtained."
          },
          "artworkCid": { "type": "string", "format": "cid" },
          "genre": { "type": "array", "items": { "type": "string", "maxLength": 64 } },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.catalog.listing`

**Updated in v5.** Adds required `licenseUri` field. The listing is the commercial offer and explicitly declares the terms under which it is made. Also adds `licenseGrantCid` — the CID of the `license.terms` record at time of listing creation, anchoring the offered terms so receipts and consent records can resolve them consistently.

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
        "required": ["item", "price", "status", "licenseUri", "licenseGrantCid", "createdAt"],
        "properties": {
          "item": { "$ref": "diamonds.whereditgo.bazaar.defs#itemRef" },
          "price": { "$ref": "diamonds.whereditgo.bazaar.defs#money" },
          "compareAtPrice": { "$ref": "diamonds.whereditgo.bazaar.defs#money" },
          "status": {
            "type": "string",
            "knownValues": ["active", "paused", "soldOut", "scheduled", "archived", "superseded"]
          },
          "licenseUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record governing this listing. Required. Takes precedence over defaultLicenseUri on the item or collection. Different listings for the same item may reference different license.terms records, enabling per-tier pricing (e.g. personal vs. commercial)."
          },
          "licenseGrantCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the license.terms record at time of listing creation. Anchors the offered terms so that receipt and consent record resolution is consistent even if the license.terms record is later updated."
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

Unchanged from v4.

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
          "itemUri": { "type": "string", "format": "at-uri" },
          "itemCid": { "type": "string", "format": "cid" },
          "isrc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Recording Code. Optional — see bazaarRid for self-issued alternative."
          },
          "iswc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Musical Work Code. Optional — see bazaarWid for self-issued alternative."
          },
          "bazaarRid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Recording Identifier. Generated as base32(SHA-256(artistDid + fileCid + fileChecksum + createdAt)). Shadows ISRC. supersededByIsrc populated when a proper ISRC is obtained."
          },
          "bazaarWid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Work Identifier. Generated as base32(SHA-256(artistDid + compositionTitle + writers[] + createdAt)). Shadows ISWC. supersededByIswc populated when a proper ISWC is obtained."
          },
          "recordingMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a recording record in an external namespace (e.g. ch.indiemusi.alpha.recording)."
          },
          "songMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a composition record — either in an external namespace (e.g. ch.indiemusi.alpha.song) or a Bazaar-native catalog.composition record."
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

### `diamonds.whereditgo.bazaar.catalog.composition`

Unchanged from v4.

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
            "description": "Title of the composition. May differ from the recording title."
          },
          "artistDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the artist publishing this record. Not necessarily the sole writer."
          },
          "iswc": {
            "type": "string",
            "maxLength": 16,
            "description": "International Standard Musical Work Code. Assigned by a PRO. Optional — see bazaarWid for self-issued alternative."
          },
          "bazaarWid": {
            "$ref": "diamonds.whereditgo.bazaar.defs#bazaarIdentifier",
            "description": "Self-issued Work Identifier. Generated as base32(SHA-256(artistDid + compositionTitle + writers[] + createdAt)). Writers array canonicalized before hashing. Shadows ISWC. supersededByIswc populated when a proper ISWC is obtained."
          },
          "writers": {
            "type": "array",
            "description": "Co-writers and their share splits. Optional — single-writer compositions may omit.",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string", "maxLength": 256 },
                "ipi": { "type": "string", "maxLength": 32, "description": "Interested Parties Information number. Assigned by a PRO." },
                "did": { "type": "string", "format": "did", "description": "ATProto DID of this writer if they have one. Optional." },
                "share": { "type": "number", "description": "Percentage of the composition. All shares should sum to 100." },
                "role": {
                  "type": "string",
                  "knownValues": ["composer", "lyricist", "composerLyricist", "arranger", "adapter"]
                }
              }
            }
          },
          "publishers": {
            "type": "array",
            "description": "Publishing administrators for this composition.",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string", "maxLength": 256 },
                "ipi": { "type": "string", "maxLength": 32 },
                "did": { "type": "string", "format": "did" },
                "pro": { "type": "string", "maxLength": 128, "description": "PRO administering this publisher's share, e.g. ASCAP, BMI, SESAC, PRS." },
                "share": { "type": "number" }
              }
            }
          },
          "proRegistrations": {
            "type": "array",
            "description": "PRO registrations for this composition across territories.",
            "items": {
              "type": "object",
              "required": ["pro"],
              "properties": {
                "pro": { "type": "string", "maxLength": 128 },
                "registrationId": { "type": "string", "maxLength": 128 },
                "territory": { "type": "string", "maxLength": 2, "description": "ISO 3166-1 alpha-2. Omit for worldwide registration." }
              }
            }
          },
          "publishingLicenseTermsUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record governing publishing rights for this composition."
          },
          "songMetaUri": {
            "type": "string",
            "format": "at-uri",
            "description": "Optional AT-URI of a song record in an external namespace (e.g. ch.indiemusi.alpha.song)."
          },
          "recordings": {
            "type": "array",
            "description": "AT-URIs of catalog.item.digital records that are recordings of this composition. Informational only — the authoritative link direction is catalog.recording → catalog.composition via songMetaUri.",
            "items": {
              "type": "object",
              "required": ["uri"],
              "properties": {
                "uri": { "type": "string", "format": "at-uri" },
                "cid": { "type": "string", "format": "cid" }
              }
            }
          },
          "copyrightYear": { "type": "integer" },
          "copyrightRegistrationId": {
            "type": "string",
            "maxLength": 128,
            "description": "Copyright office registration ID if registered, e.g. US Copyright Office PA number."
          },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.license.terms`

**Updated in v5.** Adds `requiresShareAlike` to `usageRestrictions`. Required for Creative Commons ShareAlike variants. If true, derivative works must be released under the same license terms as the original.

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
              "requiresMechanicalReporting": { "type": "boolean" },
              "requiresShareAlike": {
                "type": "boolean",
                "description": "If true, derivative works must be released under the same license terms as this work. Required for Creative Commons ShareAlike variants (CC BY-SA, CC BY-NC-SA). Absent or false means no share-alike obligation."
              }
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
            "description": "Canonical URL of the full license text. For Creative Commons licenses, this should be the canonical CC deed URL."
          },
          "summary": { "type": "string", "maxLength": 1024 },
          "editionSize": { "type": "integer", "description": "For limited editions. Absent = open edition." },
          "checkoutConsentRequired": {
            "type": "boolean",
            "default": true,
            "description": "If true, the purchasing application MUST obtain affirmative clickwrap consent before completing the transaction. Set to false for Creative Commons licenses where the grant is public and non-transactional."
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

**Updated in v5.** Adds explicit `buyerDid` field. Previously implied by `appSig` payload but not surfaced as a queryable field. Making it explicit closes the buyer identity gap and is consistent with the consent record.

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
        "required": ["item", "listingUri", "listingCid", "pricePaid", "paymentProcessor", "paymentRef", "buyerDid", "appDid", "issuerScope", "appSig", "purchasedAt"],
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
            "description": "CID of the license.terms record at time of purchase. Resolved from the listing's licenseGrantCid."
          },
          "buyerDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the buyer. Explicit field — previously only implied by appSig payload. Makes receipt queryable by buyer identity and consistent with purchase.consent record."
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
            "description": "DID of the artist/storefront this receipt was issued under."
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

### `diamonds.whereditgo.bazaar.purchase.consent`

**New in v5.**

Records the buyer's affirmative agreement to a specific `licenseGrantCid` at a specific moment. Written to the buyer's PDS alongside the receipt at checkout completion. Together the receipt and consent record form a complete named instrument: the receipt proves purchase, the consent record proves the named buyer agreed to the named terms.

Required for commercial and sync tiers. Recommended for personal use. For sync purchases, `syncProject` and `usageTier` provide additional context about the buyer's intended use.

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
        "required": ["receiptUri", "receiptCid", "licenseGrantUri", "licenseGrantCid", "buyerDid", "consentedAt", "appSig"],
        "properties": {
          "receiptUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the purchase.receipt this consent record accompanies."
          },
          "receiptCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the receipt at time of consent. Links consent to a specific, immutable receipt state."
          },
          "licenseGrantUri": {
            "type": "string",
            "format": "at-uri",
            "description": "AT-URI of the license.terms record the buyer consented to."
          },
          "licenseGrantCid": {
            "type": "string",
            "format": "cid",
            "description": "CID of the license.terms record at time of consent. The buyer agreed to these exact terms — not a future or past version."
          },
          "buyerDid": {
            "type": "string",
            "format": "did",
            "description": "DID of the buyer. Names the consenting party explicitly, making this a buyer-addressed instrument rather than an anonymous terms snapshot."
          },
          "consentedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Timestamp of affirmative consent. Combined with the PDS record's creation timestamp forms a tamper-evident assertion of when consent was given."
          },
          "appSig": {
            "type": "string",
            "description": "Base64url signature by the app service keypair over SHA-256(buyerDid:licenseGrantCid:receiptCid:consentedAt). Prevents consent records being fabricated outside the app's trust boundary."
          },
          "usageTier": {
            "type": "string",
            "knownValues": ["personal", "commercial", "sync"],
            "description": "The license tier the buyer selected at checkout. Surfaces the buyer's affirmative acknowledgment of which tier applies — redundant with the license.terms tier field but records the buyer's explicit selection."
          },
          "syncProject": {
            "type": "string",
            "maxLength": 512,
            "description": "For sync tier only. Human-readable description of the project this license covers, e.g. 'Short film: The Last Train, dir. A. Smith, 2026'. Optional but strongly recommended for sync purchases."
          }
        }
      }
    }
  }
}
```

---

### `diamonds.whereditgo.bazaar.purchase.stock`

Unchanged from v4.

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

Unchanged from v4.

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

Unchanged from v4.

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

## Identifier placement summary

| Record | `bazaar:rid` | `bazaar:wid` | `bazaar:pid` |
|---|---|---|---|
| `catalog.item.digital` | ✓ | — | — |
| `catalog.recording` | ✓ | ✓ | — |
| `catalog.composition` | — | ✓ | — |
| `catalog.collection` | — | — | ✓ |
| `catalog.item.bundle` | — | — | — |

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
| `catalog.composition` | Artist (via app OAuth) | Artist's PDS |
| `license.terms` | Artist (via app OAuth) | Artist's PDS |
| `purchase.receipt` | App service keypair | Buyer's PDS |
| `purchase.consent` | App service keypair | Buyer's PDS |
| `purchase.stock` | App service keypair | Artist's PDS |
| `purchase.fulfillment` | App or 3PL | Artist's PDS |
| `actor.profile` | Artist (via app OAuth) | Artist's PDS |

---

## Verification flow

1. Resolve `appDid` via the AT Protocol DID document to obtain the app's public verification key
2. Reconstruct the canonical payload: `SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)`
3. Verify `appSig` against the payload using the public key
4. Optionally cross-reference `paymentRef` against Stripe to confirm the transaction independently
5. Resolve `licenseGrantUri` + `licenseGrantCid` to confirm the exact license terms in force at time of purchase
6. Resolve the item URI to obtain `fileChecksum` — cross-reference against the file served by the backend to verify storage integrity
7. If `item.itemType` is `catalog.collection`, resolve the collection to enumerate the full set of `essential: true` items covered by this receipt
8. Optionally resolve `bazaarRid` or `bazaarWid` — verify the signature against the artist's DID document public key to confirm the self-issued identifier was generated by the holder of that DID
9. *(v5)* Resolve `purchase.consent` on the buyer's PDS — verify `buyerDid` matches the receipt, `licenseGrantCid` matches, and `appSig` is valid. For commercial and sync tiers, absence of a consent record is a gap in the evidentiary chain.

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
- Collection mutability means buyer entitlement set can shift if artist adds or removes essential items after purchase — snapshot entitlement semantics deferred
- Self-issued `bazaar:*` identifiers are not court-defensible ownership claims — they are timestamped, signed assertions of priority. Institutional registration remains the standard for legal enforceability
- No exclusive license mechanism — exclusivity cannot currently be expressed as a rights statement, only approximated via `maxPurchasesPerBuyer: 1` on the listing
- Territory enforcement is off-chain — `territoryCoverage` records intent but the checkout flow has no mechanism to verify buyer territory

## Action items

- **Define completeness score criteria** per `itemClass` before merchant upload form is built. Distinguish immediately-fillable fields from fields requiring external registration. External registration fields surface as a "next steps" checklist, not a score penalty.
- **Licensing UI panel** — implement as an interactive three-state panel per the directive in the Changes section. Must be built before the upload form is finalized.

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
