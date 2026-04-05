# Bazaar — Upload Form Implementation Plan

**Date:** 3 April 2026
**Status:** Implementation ready
**Scope:** Audio release upload only. Physical goods, sample packs, and presets are out of scope for this build.

```
FILE:  packages/client/src/pages/merchant/upload/digital.tsx
ROUTE: /merchant/upload/digital
AUTH:  ATProto OAuth required. Redirect to login if session absent.
STACK: React 19, React Router, react-hook-form + Zod, plain CSS
```

---

## Overview

Every audio release — including a single track — gets a `catalog.collection` wrapper. The form collects data across four linear steps and writes the following records to the artist's PDS on publish:

- One `catalog.collection`
- One `catalog.item.digital` per track
- Zero or more `catalog.item.digital` records for additional material
- One `catalog.recording` per track (always)
- One `catalog.composition` per track where Path A is taken (new composition), or zero if Path B is taken (existing composition reused)
- One `license.terms` (written once, reused if identical record already exists on the PDS)

No `catalog.listing` is written by this form. Listing creation is a separate flow at `/merchant/listings`.

No PDS writes occur before the artist confirms from the review panel in Step 4.

---

## Step structure

```
Step 1 — Release info      (catalog.collection fields)
Step 2 — Tracks & files    (catalog.item.digital + catalog.recording + catalog.composition per track)
Step 3 — License           (license.terms selection or creation)
Step 4 — Review & publish  (read-only summary, confirm gate, write sequence)
```

Render a top progress indicator showing all four steps. Each step validates before advancing. Back navigation is always available without data loss. Form state is held in React state for the lifetime of the session — no persistence to localStorage or backend until publish.

---

## Step 1 — Release info

Collects all `catalog.collection` fields.

### Fields

| Field           | Input             | Maps to                     | Required | Deferrable | Hint                                                                      |
| --------------- | ----------------- | --------------------------- | -------- | ---------- | ------------------------------------------------------------------------- |
| Release title   | text              | `collection.title`          | yes      | no         | —                                                                         |
| Collection type | segmented control | `collection.collectionType` | yes      | no         | —                                                                         |
| Release date    | date picker       | `collection.releaseDate`    | yes      | no         | —                                                                         |
| Artwork         | file drop (image) | `collection.artworkCid`     | no       | yes        | "Recommended. Visible publicly on your storefront. Can be added later."   |
| Genre           | tag input         | `collection.genre[]`        | no       | yes        | "Optional. Can be added or changed at any time."                          |
| Description     | textarea          | `collection.description`    | no       | yes        | "Optional. Can be edited after publishing."                               |
| UPC             | text              | `collection.upc`            | no       | yes        | "Optional. Add when you have it. A bazaarPid is generated automatically." |

### Behaviour

- `collectionType` segmented control options: `single`, `ep`, `album`, `compilation`, `other`. Default: `single`. No track count validation is tied to this value — the artist self-classifies.
- Artwork upload fires immediately on file selection. `POST /api/upload/artwork`. Returns `{ r2Key, cid }`. Store `cid` as `artworkCid` in form state. Store `r2Key` separately — needed to confirm delivery but not written to any PDS record. Artwork is served from the public R2 path — no auth required on delivery.
- `bazaarPid` is generated server-side at publish time. Do not show a field for it.
- All deferrable fields show the hint text specified above in muted text below the label.

---

## Step 2 — Tracks & files

Two sub-sections: **Tracks** and **Additional material**.

---

### 2a — Tracks

#### Entry point

Render a file drop zone accepting `audio/*`. Multiple files accepted in a single drop. Each dropped file becomes a track row. Artist can also add files one at a time via a file picker button.

On each file drop or selection:

1. Upload immediately to R2 via `POST /api/upload/digital`.
2. Server returns `{ r2Key, fileChecksum, fileCid, fileFormat, durationMs }`.
3. Set `itemClass: "track"` automatically. This is not user-editable for audio files.
4. Append a track row to the list with returned values pre-populated.
5. Pre-fill `title` from ID3 tags if present in the server response.

#### Track row — layout

Each row is **collapsed by default** showing: drag handle, track number, title (editable inline), duration (read-only), completeness indicator badge, expand toggle.

Expanded state reveals three labelled sections:

**Required**
**Additional metadata** — with section label: "These fields can be filled or updated after publishing."
**Rights & ownership** — with section label: "These fields establish ownership of the composition and master recording. They can be filled now or after publishing, but are required before creating a sync or commercial listing." Collapsed by default within the expanded row. Artist opens via a disclosure toggle.

#### Track row — fields

| Field         | Input             | Maps to                          | Required | Deferrable | Notes                                                          |
| ------------- | ----------------- | -------------------------------- | -------- | ---------- | -------------------------------------------------------------- |
| Track number  | integer           | `collection.items[].trackNumber` | yes      | no         | Auto-incremented. Updates on drag reorder.                     |
| Disc number   | integer           | `collection.items[].discNumber`  | no       | yes        | Hidden by default. Shown via "add disc number" toggle.         |
| Title         | text              | `item.title`                     | yes      | no         | Pre-filled from ID3 if available.                              |
| Duration      | read-only display | `item.durationMs`                | —        | —          | From server. Not editable.                                     |
| itemClass     | read-only badge   | `item.itemClass`                 | —        | —          | Always `track` for audio. Not editable.                        |
| ISRC          | text              | `recording.isrc`                 | no       | yes        | "Add when registered. A bazaarRid is generated automatically." |
| Track artwork | file drop (image) | `item.artworkCid`                | no       | yes        | "Optional. Falls back to release artwork if absent."           |
| Description   | textarea          | `item.description`               | no       | yes        | "Optional."                                                    |

#### Rights & ownership section (per track, collapsed by default)

| Field                     | Input                          | Maps to                               | Required | Deferrable | Notes                                                                                  |
| ------------------------- | ------------------------------ | ------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------- |
| Master owner              | text (DID)                     | `recording.masterOwnerDid`            | no       | yes        | Pre-filled from session DID. Editable for tracks where artist is not the master owner. |
| Publishing owner          | text (DID)                     | `recording.publishingOwnerDid`        | no       | yes        | Pre-filled from session DID. Editable.                                                 |
| Publishing owner IPI      | text                           | `recording.publishingOwnerIpi`        | no       | yes        | "Add when you have your IPI number from your PRO."                                     |
| Composition               | composition picker (see below) | `recording.songMetaUri`               | no       | yes        | See composition assignment UI.                                                         |
| ISWC                      | text                           | `composition.iswc`                    | no       | yes        | "Add when assigned by your PRO." Only shown on Path A (new composition).               |
| Co-writers                | addable list                   | `composition.writers[]`               | no       | yes        | Fields per entry: name, IPI, DID (optional), share (%), role. Only on Path A.          |
| Publishers                | addable list                   | `composition.publishers[]`            | no       | yes        | Fields per entry: name, IPI, DID (optional), PRO, share (%). Only on Path A.           |
| PRO registrations         | addable list                   | `composition.proRegistrations[]`      | no       | yes        | Fields per entry: PRO name, registration ID, territory (optional). Only on Path A.     |
| Copyright year            | integer                        | `composition.copyrightYear`           | no       | yes        | Only on Path A.                                                                        |
| Copyright registration ID | text                           | `composition.copyrightRegistrationId` | no       | yes        | "US Copyright Office PA number or equivalent." Only on Path A.                         |

#### Composition assignment UI

The composition picker is a dedicated control within the Rights & ownership section. It presents two explicit paths.

**Path A — New composition**

Default state. The artist is recording this song for the first time or has not previously uploaded it to Bazaar. All composition fields (ISWC, co-writers, publishers, PRO registrations, copyright year, copyright registration ID) are shown and editable. A new `catalog.composition` record will be written at publish time. A new `bazaarWid` will be generated.

**Path B — Existing composition**

The artist selects this path via a button: "Link to an existing composition." This opens a search/browse panel that:

1. Fetches all `catalog.composition` records from the artist's PDS via `listRecords`.
2. Displays them as selectable rows showing: composition title, `bazaarWid.id` (truncated), ISWC if present, co-writer count, linked recording count.
3. Supports text search by title.
4. On selection, populates the following in form state for this track:
   - `recording.songMetaUri` = selected composition AT-URI
   - `recording.iswc` = selected composition's `iswc` if present
   - `recording.bazaarWid` = selected composition's `bazaarWid` (copied, not regenerated)
5. Composition detail fields (co-writers, publishers, PRO registrations, ISWC, copyright) are shown read-only, populated from the selected record.
6. No new `catalog.composition` record is written at publish time.

**Conflict detection on Path B**

If the artist selects an existing composition (Path B) and then modifies any composition field (co-writers, publishers, PRO registrations, ISWC, copyright year, copyright registration ID):

- Show an inline warning immediately on edit: "You've changed the composition details. This will create a new composition record rather than linking to the existing one."
- Silently switch the track to Path A with all currently entered data pre-filled.
- Clear `recording.songMetaUri` — a new composition will be written at publish time.
- The artist can manually switch back to Path B (re-open the picker) if the edit was accidental.

#### Track row — behaviour

- Rows are reorderable via drag handle. Reordering updates `trackNumber` on all rows in sequence starting from 1.
- Each row has a remove button. Removing a track removes it from the tracks array and renumbers remaining tracks.
- Completeness indicator badge: green = all recommended fields filled, amber = deferrable fields missing, red = required fields missing.

---

### 2b — Additional material

Below the track list, a secondary section labelled "Additional material" allows the artist to attach non-audio files to the collection. These become `catalog.item.digital` records with `role` set to a non-track value. No `catalog.recording` or `catalog.composition` records are written for additional material items.

#### Entry point

A secondary file drop zone accepting `video/*, application/pdf, application/msword, text/plain, image/*` and a general catch-all.

On file drop, upload immediately to R2 via `POST /api/upload/digital`. Infer `itemClass` from MIME type:

| MIME                                              | itemClass  |
| ------------------------------------------------- | ---------- |
| `video/*`                                         | `video`    |
| `application/pdf`, `text/*`, `application/msword` | `document` |
| `image/*`                                         | `artwork`  |
| anything else                                     | `other`    |

If an audio file is dropped into the additional material zone, show a warning: "This looks like an audio file. Do you want to add it as a track instead?" Offer two buttons: "Add as track" (moves it to the tracks section) and "Keep as additional material" (proceeds with `itemClass: other`).

#### Additional material row — fields

| Field       | Input    | Maps to                        | Required | Deferrable |
| ----------- | -------- | ------------------------------ | -------- | ---------- |
| Title       | text     | `item.title`                   | yes      | no         |
| itemClass   | dropdown | `item.itemClass`               | yes      | no         |
| Role        | dropdown | `collection.items[].role`      | yes      | no         |
| Essential   | toggle   | `collection.items[].essential` | yes      | no         |
| Description | textarea | `item.description`             | no       | yes        |

`itemClass` dropdown options: `video`, `document`, `artwork`, `other`. `track` is not available here.

`role` dropdown options: `video`, `document`, `artwork`, `bonus`, `other`. Default inferred from `itemClass`.

`essential` toggle defaults to `true`. Artist sets to `false` for bonus or promotional items not included in the standard release zip.

---

## Step 3 — License

Collects the `license.terms` record that will be set as `defaultLicenseUri` on the collection.

### Behaviour

On entering this step, fetch all `license.terms` records from the artist's PDS via `listRecords`. Display them in two visually distinct groups:

**Group 1 — Your licenses** — records already on the artist's PDS. Show: title, tier, rights type, territory scope, and a count of items or listings currently referencing each one.

**Group 2 — Templates** — clearly labelled "Templates — not yet published to your storefront." Platform-provided starting points from the template library.

Selecting a record from Group 1 sets `defaultLicenseUri` to its AT-URI and `defaultLicenseCid` to its CID. No write occurs.

Selecting a template previews all its fields in a side panel. On confirm, the backend checks for an identical record on the PDS (matched by `title + version + tier + rightsType`) before writing. If found, reuses the existing AT-URI. If not found, writes a new `license.terms` record and returns the AT-URI.

Below both groups, render a collapsible contextual explanation panel with the following text verbatim:

> "A license record is published once and reused across listings. Buyers who purchase under a given license retain those exact terms permanently — changing your license on a future listing does not affect past purchases. The listing you create after publishing this release sets the authoritative license for each sale."

License selection is a hard gate. The artist cannot advance to Step 4 without a license selected or confirmed.

---

## Step 4 — Review & publish

Read-only summary of all data collected across Steps 1–3. No fields are editable here. Each section has an "edit" link that navigates back to the relevant step without losing form state.

### Sections

**1. Release**
collectionType, title, releaseDate, artwork preview (thumbnail), genre, description, UPC if provided.

**2. Tracks**
Ordered list. Per track: track number, title, duration, ISRC if provided, composition path taken (new or linked — show composition title), completeness indicator.

**3. Rights & ownership summary**
Per track: masterOwnerDid, publishingOwnerDid, composition title, co-writer count if any, ISWC if provided, bazaarWid preview (auto-generated label).

**4. Additional material**
List of non-audio items: title, itemClass, role, essential flag.

**5. License**
Selected license: title, tier, rights type, territory, summary text.

**6. Completeness score**
Integer 0–100, computed client-side. Shown prominently above the publish button.

- Score < 60: publish button disabled. Show explicit message listing missing required fields by name.
- Score 60–79: publish button enabled. Show amber advisory listing missing recommended fields. Does not block.
- Score ≥ 80: publish button enabled. Show green indicator.

### Deferrable field acknowledgement

If any deferrable fields are empty, display an informational checklist above the publish button labelled "You can fill these in later from your inventory." List each missing deferrable field by name. This is informational only — the artist does not need to interact with it. Do not gate the publish button on this checklist.

### Publish button

Disabled until completeness score ≥ 60. On click, executes the write sequence. Shows a loading state during writes with a per-step progress label. On completion, redirect to `/merchant/dashboard` with a success toast: "Your release is in your inventory."

On failure at any step, show a toast identifying which step failed. Halt without rolling back records already written. The artist can retry from the review panel — successfully written records are detected and skipped on retry.

---

## Completeness score algorithm

Computed client-side in real time. Shown in Step 4.

```
Required fields — binary gate (score 0 and publish blocked if any are missing):
  collection.title
  collection.collectionType
  collection.releaseDate
  license selected
  at least one track in the tracks array
  each track: title present

Scored recommended fields:
  collection.artworkCid present                          +15
  collection.genre has at least one entry               +10
  collection.description present                        +5
  collection.upc present                                +5
  per-track average: isrc present                       +10
  per-track average: description present                +5
  per-track average: track-level artworkCid present     +5
  bazaarRid generated (always true after upload)        +10  (auto)
  license.terms has humanReadableUrl                    +5
  license.terms has legalMetadata populated             +10
  license.terms has proNotice populated                 +10
  license.terms has summary                             +5

Maximum score from recommended fields: 95
Minimum viable publish threshold:       60
Recommended threshold:                  80
```

---

## Write sequence

Triggered on publish confirm. Execute strictly in order. Each step must succeed before the next begins. On failure, show a toast with the failed step name and halt. Do not roll back records already written. On retry, detect already-written records and skip them.

```
1. Confirm artwork blob uploaded (should be complete from Step 1 inline upload — verify r2Key present)

2. Confirm all audio and material blobs uploaded (should be complete from Step 2 inline uploads — verify r2Key present on each)

3. Write or reuse license.terms record
   - POST /api/license/resolve { title, version, tier, rightsType, ...fields }
   - Server checks artist's PDS for identical record, returns existing AT-URI or writes new record
   - Store licenseTermsUri, licenseTermsCid in write state

4. For each catalog.item.digital (tracks in trackNumber order, then additional material):
   a. POST /api/identifiers/rid { artistDid, fileCid, fileChecksum, createdAt }
      → returns bazaarRid (BazaarIdentifier signed by appDid)
   b. Write catalog.item.digital to artist's PDS via ATProto SDK (artist OAuth session)
      Fields: title, artistDid, itemClass, formats, fileChecksum, fileCid, fileFormat,
              durationMs (tracks only), artworkCid (track-level if set, else collection artworkCid),
              isrc (if provided), defaultLicenseUri (licenseTermsUri from step 3),
              collectionUri (not yet known — set in a second putRecord pass after step 6),
              bazaarRid, createdAt
   c. Store returned AT-URI and CID in write state keyed by tempId

5. For each track — write catalog.composition (Path A only):
   - If Path B: skip. songMetaUri is already set from the existing composition AT-URI.
   - If Path A:
     a. POST /api/identifiers/wid { artistDid, compositionTitle, writers[], createdAt }
        → returns bazaarWid (BazaarIdentifier signed by appDid)
        writers[] canonicalised (sorted by IPI, then DID, then name) before hashing
     b. Write catalog.composition to artist's PDS via ATProto SDK
        Fields: title, artistDid, iswc (if provided), bazaarWid, writers[], publishers[],
                proRegistrations[], copyrightYear (if provided),
                copyrightRegistrationId (if provided), createdAt
     c. Store returned AT-URI and CID in write state keyed by tempId

6. For each track — write catalog.recording:
   - Write catalog.recording to artist's PDS via ATProto SDK
     Fields: itemUri (from step 4 write state), itemCid (from step 4 write state),
             isrc (if provided), iswc (if provided),
             bazaarRid (from step 4a),
             bazaarWid (Path A: from step 5a | Path B: copied from existing composition),
             songMetaUri (Path A: composition AT-URI from step 5 | Path B: selected composition AT-URI),
             masterOwnerDid, publishingOwnerDid, publishingOwnerIpi (if provided),
             createdAt

7. Write catalog.collection to artist's PDS via ATProto SDK
   Fields: title, artistDid, collectionType, releaseDate, artworkCid,
           genre[], description (if provided), upc (if provided),
           defaultLicenseUri (licenseTermsUri from step 3),
           items[] constructed as:
             - for each track: { uri, cid, role: "track", essential: true,
                                 trackNumber, discNumber (if set), title }
             - for each additional material item: { uri, cid, role, essential, title }
           createdAt
   Store returned AT-URI as collectionUri in write state.

8. Generate bazaarPid and update collection record
   a. POST /api/identifiers/pid { artistDid, collectionUri, releaseDate }
      → returns bazaarPid (BazaarIdentifier signed by appDid)
   b. putRecord on catalog.collection — add bazaarPid field to existing record

9. Update each catalog.item.digital record — set collectionUri
   - putRecord on each catalog.item.digital written in step 4
   - Add collectionUri = collectionUri from step 7 write state
   - This is a cosmetic metadata update — freely mutable, no supersedes chain required

10. Redirect to /merchant/dashboard
    Show success toast: "Your release is in your inventory."
```

---

## Form state shape

```ts
type UploadFormState = {
  // Step 1 — collection
  collectionType: "single" | "ep" | "album" | "compilation" | "other";
  title: string;
  releaseDate: string;
  artworkCid: string | null;
  artworkR2Key: string | null;
  genre: string[];
  description: string;
  upc: string | null;

  // Step 2 — tracks
  tracks: TrackItem[];
  additionalMaterial: MaterialItem[];

  // Step 3 — license
  licenseTermsUri: string | null;
  licenseTermsCid: string | null;

  // Write state — populated during write sequence
  writeStatus: "idle" | "writing" | "done" | "error";
  writeStep: string | null;
  writtenRecords: Record<string, { uri: string; cid: string }>; // tempId → { uri, cid }
  collectionUri: string | null;
};

type TrackItem = {
  tempId: string; // client-side correlation key
  r2Key: string;
  fileChecksum: string;
  fileCid: string;
  fileFormat: string;
  durationMs: number;
  title: string;
  trackNumber: number;
  discNumber: number | null;
  isrc: string | null;
  artworkCid: string | null; // track-level artwork override
  description: string | null;
  itemClass: "track"; // fixed, not user-editable

  // Rights & ownership
  masterOwnerDid: string; // pre-filled from session DID
  publishingOwnerDid: string; // pre-filled from session DID
  publishingOwnerIpi: string | null;

  // Composition assignment
  compositionPath: "new" | "existing";
  existingCompositionUri: string | null; // Path B only
  existingCompositionCid: string | null; // Path B only
  existingBazaarWid: BazaarIdentifier | null; // Path B only — copied from existing composition

  // Composition fields — Path A only
  compositionTitle: string | null;
  iswc: string | null;
  writers: WriterEntry[];
  publishers: PublisherEntry[];
  proRegistrations: ProRegistrationEntry[];
  copyrightYear: number | null;
  copyrightRegistrationId: string | null;
};

type MaterialItem = {
  tempId: string;
  r2Key: string;
  fileChecksum: string;
  fileCid: string;
  fileFormat: string;
  durationMs: number | null;
  title: string;
  itemClass: "video" | "document" | "artwork" | "other";
  role: "video" | "document" | "artwork" | "bonus" | "other";
  essential: boolean;
  description: string | null;
};

type WriterEntry = {
  name: string;
  ipi: string | null;
  did: string | null;
  share: number | null;
  role:
    | "composer"
    | "lyricist"
    | "composerLyricist"
    | "arranger"
    | "adapter"
    | null;
};

type PublisherEntry = {
  name: string;
  ipi: string | null;
  did: string | null;
  pro: string | null;
  share: number | null;
};

type ProRegistrationEntry = {
  pro: string;
  registrationId: string | null;
  territory: string | null;
};

type BazaarIdentifier = {
  id: string;
  sig: string;
  generatedAt: string;
};
```

---

## API routes required (server)

```
POST /api/upload/artwork
  body: multipart form, field: file (image/*)
  auth: ATProto session
  returns: { r2Key: string, cid: string }

POST /api/upload/digital
  body: multipart form, field: file (audio/*, video/*, application/*, text/*)
  auth: ATProto session
  returns: {
    r2Key: string,
    fileChecksum: string,
    fileCid: string,
    fileFormat: string,
    durationMs: number | null,
    id3Title: string | null
  }

POST /api/license/resolve
  body: full license.terms field set
  auth: ATProto session
  behaviour: checks artist PDS for identical record (title + version + tier + rightsType),
             writes new record if not found
  returns: { uri: string, cid: string, wasExisting: boolean }

POST /api/identifiers/rid
  body: { artistDid: string, fileCid: string, fileChecksum: string, createdAt: string }
  auth: ATProto session
  returns: { bazaarRid: BazaarIdentifier }

POST /api/identifiers/wid
  body: { artistDid: string, compositionTitle: string, writers: WriterEntry[], createdAt: string }
  auth: ATProto session
  behaviour: canonicalises writers array before hashing (sort by ipi, then did, then name)
  returns: { bazaarWid: BazaarIdentifier }

POST /api/identifiers/pid
  body: { artistDid: string, collectionUri: string, releaseDate: string }
  auth: ATProto session
  returns: { bazaarPid: BazaarIdentifier }
```

All identifier endpoints sign with the app service keypair (`appDid`). See `26_4_3-identifier-signing-strategy.md` for the full signing strategy and canonical payload definitions.

PDS writes (`catalog.item.digital`, `catalog.composition`, `catalog.recording`, `catalog.collection`) are performed client-side via the ATProto SDK using the artist's OAuth session. The server does not proxy PDS writes.

---

## itemClass UI constraints

The following `itemClass` values are presented in the UI for this build:

| Context                    | Values shown                                               |
| -------------------------- | ---------------------------------------------------------- |
| Track rows                 | `track` (fixed, not a picker — shown as a read-only badge) |
| Additional material picker | `video`, `document`, `artwork`, `other`                    |

The following lexicon-valid `itemClass` values are deliberately excluded from the UI in this build: `album`, `samplePack`, `preset`, `stems`, `ebook`. The lexicon primitives are preserved unchanged. This is a UI-layer constraint only.

---

## Out of scope for this form

- `catalog.listing` creation — separate flow at `/merchant/listings`
- Physical goods
- Multi-artist / multi-tenant support
- Download link generation and delivery
- Buyer ATProto login at checkout
- PRO royalty remittance
- Cover song / mechanical compliance tooling
- i18n and multi-currency
