# Bazaar — License Templates
**Date:** 3 April 2026
**Status:** v1 — initial template set, conforming to license.terms lexicon v5
**Source path:** `packages/shared/src/license-templates/`

All templates below are pre-authored records conforming to `diamonds.whereditgo.bazaar.license.terms`. They are written to the artist's PDS on first use and reused across subsequent listings. Each template omits `createdAt` — that field is populated at write time by the backend.

Templates are divided into two groups: Bazaar-native (paid, buyer-specific grants) and Creative Commons (public grants, appropriate for free or pay-what-you-want listings only).

---

## Bazaar-Native Templates

---

### Personal Use

Standard paid download for personal listening only. No commercial rights, no derivatives, no sync. The minimum viable license for any paid listing. Satisfies the upload form's hard gate with two clicks.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Personal Use",
  "tier": "personal",
  "rightsType": "master",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": false,
    "allowsDerivatives": false,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": false,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "For personal listening only. No commercial use, sync, broadcast, or derivative works permitted."
}
```

---

### Personal Use with Attribution

Same as Personal Use but the buyer must credit the artist when sharing or referencing the work publicly. Appropriate for artists who want their name attached to any downstream sharing.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Personal Use with Attribution",
  "tier": "personal",
  "rightsType": "master",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": false,
    "allowsDerivatives": false,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "For personal listening only. Credit the artist when sharing or referencing this work publicly."
}
```

---

### Commercial Use — Master Only

Buyer may use the recording in commercial contexts: YouTube monetization, podcasts, advertisements, branded content. Publishing rights are not cleared — the buyer is responsible for any mechanical or sync obligations on the composition side. Appropriate when the artist controls the master but not the publishing, or wants to separate the two rights stacks commercially.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Commercial Use — Master Only",
  "tier": "commercial",
  "rightsType": "master",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": false,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "Commercial use of the master recording permitted. Publishing rights not included — buyer is responsible for any composition-side clearance."
}
```

---

### Commercial Use with Derivatives — Master Only

Buyer may use the recording commercially and create derivative works — remixes, edits, interpolations — from the master. Publishing rights not cleared. Appropriate for sample packs, stems sold for remix use, or tracks licensed for creative reuse.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Commercial Use with Derivatives — Master Only",
  "tier": "commercial",
  "rightsType": "master",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": true,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "Commercial use and derivative works permitted on the master recording. Publishing rights not included."
}
```

---

### Stem License

Buyer receives component stems for remixing or production use. Commercial use of derivative works permitted. Master only — the stems are recordings and the buyer may create new recordings from them. Attribution required. Appropriate for stem packs sold for use in production or DJ sets.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Stem License",
  "tier": "stemLicense",
  "rightsType": "master",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": true,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "Stems licensed for remixing and commercial production use. Credit the original artist in derivative works."
}
```

---

### Sync License — Master Only

Buyer may synchronize the recording to visual media: film, television, advertising, online video. Publishing rights not cleared — the buyer must separately clear the composition through the relevant PRO or publisher. Appropriate when the artist controls the master but not the publishing rights.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Sync License — Master Only",
  "tier": "syncMaster",
  "rightsType": "master",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": false,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": false,
    "allowsSync": true,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": true,
    "requiresShareAlike": false
  },
  "summary": "Sync rights granted for the master recording only. Buyer must separately clear publishing rights. Mechanical reporting required."
}
```

---

### Sync License — Publishing Only

Buyer clears the composition for sync use. Master rights not included — the buyer must separately license the recording from the master rights holder. Appropriate for artists who control publishing but not the master, or for instrumentalists licensing a co-write.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Sync License — Publishing Only",
  "tier": "syncPublishing",
  "rightsType": "publishing",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": false,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": false,
    "allowsSync": true,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": true,
    "requiresShareAlike": false
  },
  "summary": "Publishing rights cleared for sync use. Master rights not included — buyer must separately license the recording."
}
```

---

### Sync License — Full Clearance

Both master and publishing rights cleared for sync use in a single purchase. The buyer may synchronize the work to visual media without separately clearing either rights stack. Appropriate when the artist controls both master and publishing and wants to offer a single-purchase sync solution.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Sync License — Full Clearance",
  "tier": "syncFull",
  "rightsType": "both",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": false,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": false,
    "allowsSync": true,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": true,
    "requiresShareAlike": false
  },
  "summary": "Full sync clearance — both master and publishing rights included. No separate clearance required."
}
```

---

### Broadcast License

Buyer may use the recording in broadcast contexts: radio, television, streaming platforms. Both master and publishing rights covered. Mechanical reporting required. Appropriate for artists licensing work for broadcast use directly rather than through a PRO blanket deal.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Broadcast License",
  "tier": "broadcast",
  "rightsType": "both",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": false,
    "allowsCommercialUse": true,
    "allowsDerivatives": false,
    "allowsSync": false,
    "allowsBroadcast": true,
    "requiresAttribution": true,
    "requiresMechanicalReporting": true,
    "requiresShareAlike": false
  },
  "summary": "Broadcast rights granted for radio, television, and streaming platforms. Mechanical reporting required."
}
```

---

### Mechanical License

Buyer may reproduce the composition in a new recording — a cover version. Publishing rights only. Does not cover the original master recording. The buyer creates their own master; this license clears the right to record the composition. Mechanical reporting required.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Mechanical License",
  "tier": "mechanical",
  "rightsType": "publishing",
  "version": "1.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": true,
  "usageRestrictions": {
    "allowsStreaming": false,
    "allowsDownload": false,
    "allowsCommercialUse": true,
    "allowsDerivatives": true,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": true,
    "requiresShareAlike": false
  },
  "summary": "Mechanical rights granted to record a cover version of this composition. Original master not included. Mechanical reporting required."
}
```

---

## Creative Commons Templates

Creative Commons licenses are public grants — they apply to the world, not to a specific buyer. They are appropriate for free or pay-what-you-want listings only. Do not apply CC licenses to paid listings where the buyer expects exclusive or buyer-specific rights. `checkoutConsentRequired` is false for all CC templates — consent is implicit in the public license terms.

---

### CC BY 4.0 — Attribution

Full open use with attribution. Commercial use, derivatives, sync, and broadcast all permitted. The most permissive CC license. Buyer must credit the artist.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Creative Commons Attribution 4.0 (CC BY)",
  "tier": "personal",
  "rightsType": "master",
  "version": "4.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": false,
  "humanReadableUrl": "https://creativecommons.org/licenses/by/4.0/",
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": true,
    "allowsSync": true,
    "allowsBroadcast": true,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "Free to use for any purpose including commercial, with attribution. Derivatives permitted. This is a public grant, not a buyer-specific license."
}
```

---

### CC BY-NC 4.0 — Attribution, Non-Commercial

Free use with attribution, non-commercial only. Derivatives permitted in non-commercial contexts. No sync for commercial projects, no broadcast monetization.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC)",
  "tier": "personal",
  "rightsType": "master",
  "version": "4.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": false,
  "humanReadableUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": false,
    "allowsDerivatives": true,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "Free to use for non-commercial purposes with attribution. Derivatives permitted in non-commercial contexts. This is a public grant, not a buyer-specific license."
}
```

---

### CC BY-NC-ND 4.0 — Attribution, Non-Commercial, No Derivatives

Most restrictive CC variant that still allows free distribution. Non-commercial only, no modifications of any kind, attribution required. Appropriate for artists who want free sharing with no remixing.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 (CC BY-NC-ND)",
  "tier": "personal",
  "rightsType": "master",
  "version": "4.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": false,
  "humanReadableUrl": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": false,
    "allowsDerivatives": false,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": false
  },
  "summary": "Free to share with attribution. No commercial use and no modifications permitted. This is a public grant, not a buyer-specific license."
}
```

---

### CC BY-SA 4.0 — Attribution, ShareAlike

Full open use with attribution. Derivatives must be released under the same CC BY-SA terms. Copyleft — anything built from this work must remain freely available under the same conditions.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA)",
  "tier": "personal",
  "rightsType": "master",
  "version": "4.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": false,
  "humanReadableUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": true,
    "allowsDerivatives": true,
    "allowsSync": true,
    "allowsBroadcast": true,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": true
  },
  "summary": "Free to use for any purpose with attribution. Derivatives must be released under CC BY-SA. This is a public grant, not a buyer-specific license."
}
```

---

### CC BY-NC-SA 4.0 — Attribution, Non-Commercial, ShareAlike

Non-commercial use with attribution. Derivatives must be released under the same CC BY-NC-SA terms. Copyleft within the non-commercial sphere.

```json
{
  "$type": "diamonds.whereditgo.bazaar.license.terms",
  "title": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA)",
  "tier": "personal",
  "rightsType": "master",
  "version": "4.0",
  "territoryCoverage": { "scope": "worldwide" },
  "checkoutConsentRequired": false,
  "humanReadableUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "usageRestrictions": {
    "allowsStreaming": true,
    "allowsDownload": true,
    "allowsCommercialUse": false,
    "allowsDerivatives": true,
    "allowsSync": false,
    "allowsBroadcast": false,
    "requiresAttribution": true,
    "requiresMechanicalReporting": false,
    "requiresShareAlike": true
  },
  "summary": "Free to use for non-commercial purposes with attribution. Derivatives must be released under CC BY-NC-SA. This is a public grant, not a buyer-specific license."
}
```

---

## Template summary

| Template | Tier | Rights type | Commercial | Derivatives | Sync | Broadcast | Attribution | Share-alike | CC |
|---|---|---|---|---|---|---|---|---|---|
| Personal Use | personal | master | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Personal Use with Attribution | personal | master | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Commercial — Master Only | commercial | master | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Commercial with Derivatives | commercial | master | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Stem License | stemLicense | master | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Sync — Master Only | syncMaster | master | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Sync — Publishing Only | syncPublishing | publishing | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Sync — Full Clearance | syncFull | both | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Broadcast | broadcast | both | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| Mechanical | mechanical | publishing | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| CC BY 4.0 | personal | master | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| CC BY-NC 4.0 | personal | master | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| CC BY-NC-ND 4.0 | personal | master | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ |
| CC BY-SA 4.0 | personal | master | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CC BY-NC-SA 4.0 | personal | master | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |

---

## Notes for implementation

**PDS write behaviour** — on first use of a template, the backend checks whether an identical `license.terms` record (matched by `title` + `version` + `tier` + `rightsType`) already exists on the artist's PDS before writing. If found, the existing record's AT-URI is reused. No duplicate records are written.

**Template customisation** — if an artist modifies any field on a template (territory restriction, term length, attribution requirements), a new record is always written. Modified templates are never treated as matching a base template for deduplication purposes.

**CC templates and paid listings** — the licensing UI panel must warn the artist if they attempt to attach a CC template to a listing with a price greater than zero. CC licenses are public grants; charging for them creates a legal inconsistency. The UI should surface this as a blocking warning, not a hard error — the artist may have a legitimate reason (e.g. charging for file delivery while the rights are CC) but must acknowledge the implication.

**`requiresShareAlike` enforcement** — the lexicon records the share-alike obligation but cannot enforce it. The platform does not track downstream derivative works. This field is informational for the buyer and evidentiary for the artist; enforcement is off-chain.
