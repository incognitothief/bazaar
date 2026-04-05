```
TASK: Implement the audio release upload form
FILE: packages/client/src/pages/merchant/upload/digital.tsx
ROUTE: /merchant/upload/digital
AUTH: ATProto OAuth required. Redirect to login if session absent.
STACK: React 19, React Router, react-hook-form + Zod, plain CSS
```

---

## Overview

The upload form is a linear multi-step flow that collects all data required to write the following records to the artist's PDS:

- One `catalog.collection` (always — every release, including a single track, gets a collection wrapper)
- One `catalog.item.digital` per audio track
- Zero or more `catalog.item.digital` records for additional material (video, document, other)
- One `license.terms` record (written once, reused if an identical record already exists on the PDS)

The form does not write a `catalog.listing`. Listing creation is a separate flow triggered from `/merchant/listings` after the release is in inventory.

The publish button does not become available until the review panel has been shown and the artist has confirmed. No PDS writes occur before confirmation.

---

## Step structure

The form has four steps rendered as a top progress indicator. Each step validates before advancing. Back navigation is always available without data loss.

```
Step 1 — Release info      (collection-level)
Step 2 — Tracks & files    (per-item)
Step 3 — License           (license.terms selection or creation)
Step 4 — Review & publish  (read-only summary, confirm gate)
```

---

## Step 1 — Release info

Collects all `catalog.collection` fields.

**Fields:**

| Field           | Input type        | Required | Deferrable | Hint                                                                    |
| --------------- | ----------------- | -------- | ---------- | ----------------------------------------------------------------------- |
| Release title   | text              | yes      | no         | —                                                                       |
| Collection type | segmented control | yes      | no         | Single / EP / Album / Compilation / Other                               |
| Release date    | date picker       | yes      | no         | —                                                                       |
| Artwork         | file drop (image) | no       | yes        | "Recommended. Visible publicly on your storefront. Can be added later." |
| Genre           | tag input         | no       | yes        | "Optional. Can be added or changed at any time."                        |
| Description     | textarea          | no       | yes        | "Optional. Can be edited after publishing."                             |
| UPC             | text              | no       | yes        | "Optional. Add when you have it. bazaarPid is generated automatically." |

**Behaviour:**

- `collectionType` defaults to `single`. Artist changes it freely. No track count validation tied to this value.
- Artwork upload fires immediately on file selection. Image is uploaded to R2 via `POST /api/upload/artwork`. Returns `{ r2Key, cid }`. The CID is stored in form state as `artworkCid`. Artwork is served from the public R2 path — no auth required.
- `bazaarPid` is generated server-side at publish time, not collected in the form. Do not show a field for it.
- All deferrable fields show an inline hint in muted text below the label. The hint text is exactly as specified in the table above.

---

## Step 2 — Tracks & files

Collects one `catalog.item.digital` per track and any additional material. This step has two sub-sections: Tracks and Additional material.

### 2a — Tracks

**Entry point:**

Render a file drop zone accepting `audio/*`. Multiple files accepted in one drop. Each dropped file becomes a track row. Artist can also add files one at a time.

On file drop:

1. Each file is uploaded immediately to R2 via `POST /api/upload/digital`.
2. Server returns `{ r2Key, fileChecksum, fileCid, fileFormat, durationMs }`.
3. Server infers `itemClass: "track"` for all audio files. This is not overridable for audio — it is set automatically.
4. A track row is appended to the list with the returned metadata pre-populated.

**Track row — fields:**

Each track row is collapsed by default showing only track number, title, and duration. An expand toggle reveals the full metadata panel.

| Field            | Input type                                    | Required | Deferrable | Notes                                                                                  |
| ---------------- | --------------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------- |
| Track number     | integer (auto-assigned, draggable to reorder) | yes      | no         | Auto-increments. Drag to reorder updates all track numbers.                            |
| Disc number      | integer                                       | no       | yes        | "For multi-disc releases only." Hidden by default, shown via "add disc number" toggle. |
| Title            | text                                          | yes      | no         | Pre-filled from file ID3 tags if present.                                              |
| Duration         | read-only                                     | —        | —          | Populated from `durationMs` returned by server. Not editable.                          |
| ISRC             | text                                          | no       | yes        | "Add when registered. bazaarRid is generated automatically."                           |
| itemClass        | read-only display                             | —        | —          | Always `track` for audio files. Shown as a non-editable badge.                         |
| Artwork override | file drop (image)                             | no       | yes        | "Optional. Falls back to release artwork if absent."                                   |
| Description      | textarea                                      | no       | yes        | "Optional."                                                                            |

**Track row — behaviour:**

- Rows are reorderable via drag handle. Reordering updates `trackNumber` on all rows in sequence.
- Each row has a remove button. Removing a track removes it from the collection items array.
- The collapsed row shows: track number, title, duration, and a completeness indicator (green = all recommended fields filled, amber = deferrable fields missing, red = required fields missing).
- The expanded panel groups fields visually into two sections: **Required** (title, track number) and **Additional metadata** (ISRC, disc number, description, artwork override). The Additional metadata section has a section label: "These fields can be filled or updated after publishing."

### 2b — Additional material

Below the track list, a secondary section labelled "Additional material" allows the artist to attach non-audio files to the collection. These become `catalog.item.digital` records with `essential: false` and a `role` value other than `track`.

**Entry point:**

A secondary file drop zone accepting `video/*, application/pdf, application/msword, text/plain, image/*` and a catch-all. Each dropped file becomes an additional material row.

**itemClass inference from MIME type:**

| MIME                                         | itemClass assigned |
| -------------------------------------------- | ------------------ |
| video/\*                                     | `video`            |
| application/pdf, text/\*, application/msword | `document`         |
| image/\*                                     | `artwork`          |
| anything else                                | `other`            |

Artist can override `itemClass` on any additional material row via a dropdown showing: `video`, `document`, `artwork`, `other`. The `track` value is not available in this dropdown — audio files added here would be unusual; if an audio file is dropped into the additional material zone, warn the artist and offer to move it to the tracks section instead.

**Additional material row fields:**

| Field       | Input type | Required | Deferrable |
| ----------- | ---------- | -------- | ---------- |
| Title       | text       | yes      | no         |
| itemClass   | dropdown   | yes      | no         |
| Role        | dropdown   | yes      | no         |
| Essential   | toggle     | yes      | no         |
| Description | textarea   | no       | yes        |

Role dropdown values: `video`, `document`, `artwork`, `bonus`, `other`. Default is inferred from itemClass. Essential toggle defaults to `true`. Artist should set to `false` for bonus or promotional items.

---

## Step 3 — License

Collects the `license.terms` record that will be set as `defaultLicenseUri` on the collection and pre-populated when the artist later creates a listing.

**Behaviour:**

- On entering this step, fetch existing `license.terms` records from the artist's PDS. Display them as selectable cards showing: title, tier, rights type, territory.
- Below existing records, display the platform template library as a separate group clearly labelled "Templates — not yet published to your storefront."
- Selecting an existing record sets `defaultLicenseUri` to its AT-URI. No new record is written.
- Selecting a template previews its fields. On confirm, the backend checks for an identical record on the PDS (matched by `title + version + tier + rightsType`) before writing. If found, reuses the existing record's AT-URI.
- This step follows the licensing UI directive from lexicon v5: show (1) existing records, (2) templates, (3) contextual explanation. The contextual explanation is a collapsible panel with the text: "A license record is published once and reused across listings. Buyers who purchase under a given license retain those exact terms permanently — changing your license on a future listing does not affect past purchases."
- License selection is a hard gate. The artist cannot advance to Step 4 without selecting or confirming a license.

---

## Step 4 — Review & publish

A read-only summary of everything collected across Steps 1–3. No fields are editable here. Each section has an "edit" link that navigates back to the relevant step.

**Sections displayed:**

1. **Release** — collectionType, title, releaseDate, artworkCid preview, genre, description, UPC if provided
2. **Tracks** — ordered list of all tracks showing title, duration, ISRC if provided, completeness indicator
3. **Additional material** — list of non-audio items showing title, itemClass, role, essential flag
4. **License** — selected license title, tier, rights type, territory, summary text
5. **Completeness score** — integer 0–100 computed from field coverage across all records. Shown prominently. Score below 60 blocks publish with an explicit message listing the missing required fields. Score 60–79 shows an amber warning listing recommended fields that are missing but does not block. Score 80+ shows green.

**Deferrable field acknowledgement:**

If any deferrable fields are empty, display a checklist of them above the publish button with the label: "You can fill these in later from your inventory." Each item in the checklist is named. The artist does not need to check anything — this is informational only, not a consent gate.

**Publish button:**

Disabled until completeness score ≥ 60. When clicked, executes the write sequence below. Shows a loading state during writes. On completion, redirects to `/merchant/dashboard` with a success toast.

---

## Write sequence (triggered on publish confirm)

Execute in order. Each step must succeed before the next begins. On failure, show a toast with the failed step and halt without partial cleanup — records already written are kept. The artist can retry from the review panel.

```
1. Upload any artwork blobs not yet uploaded (should already be done inline — this is a safety check)
2. Upload any audio/file blobs not yet uploaded (same — inline uploads should have completed)
3. Write or reuse license.terms record on artist's PDS
4. For each catalog.item.digital (tracks + additional material):
     - Generate bazaarRid server-side: base32(SHA-256(artistDid + fileCid + fileChecksum + createdAt))
     - Write catalog.item.digital record to artist's PDS via ATProto OAuth
     - Store returned AT-URI and CID in session state
5. Write catalog.collection record to artist's PDS:
     - items[] constructed from all catalog.item.digital AT-URIs written in step 4
     - role and essential set per form values
     - trackNumber and discNumber set per form values for track-role items
     - defaultLicenseUri set to the license.terms AT-URI from step 3
     - Generate bazaarPid server-side: base32(SHA-256(artistDid + collectionUri + releaseDate))
     - artworkCid set from the R2 upload CID
6. Redirect to /merchant/dashboard
```

---

## Form state shape (React)

```ts
type UploadFormState = {
  // Step 1
  collectionType: "single" | "ep" | "album" | "compilation" | "other";
  title: string;
  releaseDate: string;
  artworkCid: string | null;
  artworkR2Key: string | null;
  genre: string[];
  description: string;
  upc: string | null;

  // Step 2
  tracks: TrackItem[];
  additionalMaterial: MaterialItem[];

  // Step 3
  licenseTermsUri: string | null; // AT-URI of selected or written license.terms
  licenseTermsCid: string | null; // CID of selected license.terms

  // Write state
  writeStatus: "idle" | "writing" | "done" | "error";
  writtenItemUris: Record<string, string>; // tempId → AT-URI, populated during write sequence
};

type TrackItem = {
  tempId: string; // client-side only, used to correlate before AT-URIs are known
  r2Key: string;
  fileChecksum: string;
  fileCid: string;
  fileFormat: string;
  durationMs: number;
  title: string;
  trackNumber: number;
  discNumber: number | null;
  isrc: string | null;
  artworkCid: string | null; // track-level override
  description: string | null;
  itemClass: "track"; // always track for audio, not user-editable
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
```

---

## Completeness score algorithm

Score is computed client-side in real time and shown on Step 4.

```
Required fields (failure = score 0, publish blocked):
  collection.title                     +0 (required, no points — binary gate)
  collection.collectionType            +0
  collection.releaseDate               +0
  license selected                     +0
  at least one track                   +0
  each track: title present            +0

Recommended fields (each contributes to score):
  collection.artworkCid                +15
  collection.genre (at least one)      +10
  collection.description               +5
  collection.upc                       +5
  per track avg: isrc present          +10
  per track avg: description present   +5
  per track avg: artworkCid present    +5 (track-level override, low weight)
  bazaarRid generated (server-side)    +10  (auto, always present after upload)
  license.terms has humanReadableUrl   +5
  license.terms has legalMetadata      +10
  license.terms has proNotice          +10
  license.terms has summary            +5

Max score from recommended fields: 95
Minimum viable publish threshold: 60
Recommended threshold: 80
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
  returns: { r2Key: string, fileChecksum: string, fileCid: string, fileFormat: string, durationMs: number | null }

POST /api/identifiers/rid
  body: { artistDid, fileCid, fileChecksum, createdAt }
  auth: ATProto session
  returns: { bazaarRid: BazaarIdentifier }

POST /api/identifiers/pid
  body: { artistDid, collectionUri, releaseDate }
  auth: ATProto session
  returns: { bazaarPid: BazaarIdentifier }
```

PDS writes (license.terms, catalog.item.digital, catalog.collection) are performed client-side via the ATProto SDK using the artist's OAuth session. The server does not proxy PDS writes.

---

## Out of scope for this form

- Listing creation (price, availability, listing-level license) — separate flow at `/merchant/listings`
- `catalog.recording` and `catalog.composition` records — surfaced as a post-publish "next steps" prompt, not part of this form
- Physical goods
- Multi-artist support
- Download link generation
