# Improve uploads — guardrails

## `UploadDigitalPage` (legacy / fallback)

- Not the primary flow today; it mirrors an earlier data model and remains available as a fallback.
- **Do not remove** it.
- **Do not aggressively refactor or “sync” it** while iterating on the tracks-specific upload flow; extend it deliberately when that work is scheduled.

## `UploadTracksPage` (active tracks / inventory flow)

- Optimize for the **tracks + inventory-session** use case, not for every field or item class in the shared digital catalog lexicon.
- **No need to cover** all `catalog.item.digital` (and related) shapes or non-track item classes on this page; broader catalog work can follow later with explicit design.

## Cross-page discipline

- Tracks improvements should **not** drive large, implicit changes to the digital fallback page unless the task explicitly includes both.
