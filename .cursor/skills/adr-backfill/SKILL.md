---
name: adr-backfill
description: >-
  Investigates git history and code to backfill missing features into existing
  Architecture Decision Records. Use when the user mentions ADR backfill, missed
  features in ADRs, retroactive documentation, or points at code/constants that
  should be documented in ADR files.
---

# ADR Backfill

Retroactively document features that shipped before (or were omitted from) an initial ADR pass. This is a **recurring gap-fill workflow**, not greenfield ADR authoring.

## Discover workspace context first

Before investigating a feature, locate where this repo (or monorepo package) keeps ADRs:

```bash
# Common locations
find . -type d \( -name ADR -o -name adr -o -name 'architecture' \) 2>/dev/null | head -20
rg -l '^# ADR' --glob '*.md' 2>/dev/null | head -20
```

Also read project docs for ADR policy:

- `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, or `docs/README.md`
- Look for: ADR directory path, numbering scheme, append-only rules, and whether **backfill edits to existing ADRs** are allowed

| If you find                     | Then                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Single `docs/ADR/` (or similar) | Use that path for the whole repo                                                                            |
| Per-package ADRs in a monorepo  | Scope investigation to the package that owns the feature                                                    |
| No ADRs                         | Tell the operator; do not invent an ADR tree unless they ask to start one                                   |
| Append-only policy              | Backfill is an explicit exception — only when filling gaps in an initial batch, not revising live decisions |

When the workspace has multiple ADR roots, ask which package/repo owns the feature unless the code path makes it obvious.

---

## Subroutine overview

Run in two phases unless the user asks to skip straight to edits.

```
Phase 1 — Investigate & recommend   (read-only; present findings)
Phase 2 — Inject                    (edit ADRs after operator alignment)
```

Copy this checklist and track progress:

```
ADR Backfill Progress:
- [ ] 0. Discover ADR path and project policy
- [ ] 1. Anchor feature (file, module, or user pointer)
- [ ] 2. Trace git history for introduction + follow-ups
- [ ] 3. Map runtime behavior (call sites, errors, config)
- [ ] 4. Read candidate ADRs; note naming collisions / related concepts
- [ ] 5. Recommend placement (primary ADR + optional cross-refs)
- [ ] 6. Present analysis; wait for alignment unless told to proceed
- [ ] 7. Inject into ADR(s); match existing voice and structure
```

---

## Phase 1: Investigate

### 1. Anchor the feature

Start from whatever the user pointed at: a file, constant, module, endpoint, migration, or behavior description. Read it fully before searching history.

Run git commands from the **git root that contains the feature** (repo root or monorepo package root).

### 2. Git archaeology

```bash
# File introduction and amendments
git log --follow --format='%h %ad %s' --date=short -- <path>

# First commit that introduced a symbol or string
git log -p --follow -S '<symbol-or-unique-string>' -- <scope>/ | head -200

# Keyword sweep when path is unknown
git log --all --oneline --grep='<keyword>' -i -- <scope>/ | head -30
```

Build a **timeline table**: date, commit, one-line summary, what changed (not just the diff stat).

Compare timeline to ADR dates. Backfilled ADRs often have implementation dates **before** the commit that introduced the ADR batch — gaps are expected.

```bash
# When was the ADR backfill batch?
git log --oneline --format='%h %ad %s' --date=short -- <adr-dir>/ | head -10
```

### 3. Map runtime behavior

Answer before writing anything:

| Question                                                           | Why it matters                                   |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| Where is it enforced? (services, guards, middleware, UI)           | ADR must name the owning module                  |
| What are the user-facing outcomes? (errors, API shapes, UI states) | Document behavior, not just the constant         |
| Is it config, code constant, DB, or infra?                         | Drives deploy vs schema language                 |
| Does it share vocabulary with another concept?                     | Disambiguate colliding terms in the ADR          |
| Cross-cutting? (auth + API + UI)                                   | May need primary ADR + short cross-ref elsewhere |

Grep for imports and call sites; read surrounding code for check order and error messages.

### 4. Read candidate ADRs

List ADRs in the discovered directory. Skim Context + Decision sections for the feature's **domain owner**. Prefer **extending an existing ADR** over a new number when the feature is a constraint or subsection of an accepted decision.

**Placement decision tree:**

```
Is this a wholly new architectural decision with its own trade-offs?
├─ YES → New ADR (next number in this repo's scheme), reference related ADRs
└─ NO → Patch existing ADR
         ├─ Primary home: ADR that owns the module/lifecycle
         ├─ Cross-ref only: ADR where behavior is consumed but not owned
         └─ Skip: ADRs that share a word but different domain
```

Infrastructure-only details → the repo's infrastructure/platform ADR if one exists.

### 5. Phase 1 deliverable (present to operator)

Use this template:

```markdown
## [Feature name] — backfill analysis

**ADR root:** `<path>`

### Change history

| Date | Commit | Change |
| ---- | ------ | ------ |

### Nuance to capture

- ...

### Recommended placement

**Primary:** ADR NNNN — [section name]
**Cross-ref:** ADR MMMM — [one sentence why] (optional)

### Proposed insertions

[Draft markdown snippets for each ADR section]

### Not documented in

| ADR | Why skip |
```

Stop here unless the user said to inject immediately.

---

## Phase 2: Inject

Only edit ADRs after explicit operator alignment ("go ahead", "inject it", "I'm aligned").

### Match existing ADR style

**Read 2–3 ADRs in the target directory** and mirror their structure (headings, status values, date format, subsection numbering, consequence groupings). Do not assume a global template.

Common patterns (adapt to what the repo actually uses):

```markdown
# ADR NNNN: Title

## Status

Accepted

## Date

YYYY-MM-DD ← original decision date, not backfill date

## Context

...

## Decision

### N. Section

...

## Consequences

**Positive**
**Negative / trade-offs**
**Deferred**
```

When backfilling:

- Insert into **Decision** (new subsection or bullets under an existing lifecycle section).
- Add **Constraints** table rows when the feature is a rule with a fixed value.
- Add **Consequences** bullets for trade-offs (e.g. manual list maintenance).
- Use **Deferred** only for genuinely unfinished work — not speculative future work unless that matches the repo's existing pattern.

Do **not**:

- Change Status or Date to "today" unless creating a new ADR.
- Reword unrelated sections or "clean up" prose the operator didn't ask for.
- Create a new ADR for a small constraint that clearly belongs inside an existing one.

### Section templates

**Lifecycle constraint** (after validation, before main action):

```markdown
**[Feature name]** — after [prerequisite step], before [next step]:

[One paragraph: what, where in code, why.]

- [Enforcement point]: [outcome]
- [Enforcement point]: [outcome]

[Disambiguation sentence if vocabulary collides with another concept.]
```

**Constraints table row:**

```markdown
| [Rule name] | [Value or reference to constant/path] |
```

**Cross-reference** (minimal; link to primary ADR):

```markdown
**[Topic]:** [One sentence]. See ADR NNNN for [lifecycle / policy / etc.].
```

**Cross-module hook** — extend numbered steps in an existing flow; don't duplicate the full spec.

### After editing

- Re-read injected sections for terminology consistency with the rest of that ADR.
- Do not commit unless the user asks.

---

## Example (generic)

**Feature:** `src/constants/blocked-identifiers.ts` in a service that validates user-chosen names.

| Phase     | Outcome                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| History   | Introduced in an early commit with validation hooks; identifiers added ad hoc in later PRs |
| Nuance    | Static blocklist ≠ a separate "reserved" status enum; enforced at signup and rename        |
| Primary   | ADR for identity/naming lifecycle — full spec + constraints row + consequences             |
| Cross-ref | ADR for registration flow — reject blocklisted names before ID assignment                  |

---

## Commands quick reference

```bash
cd <git-root-for-feature>

# ADR index
ls <adr-dir>/

# Who calls this symbol?
rg '<symbol>' --glob '*.<ext>'

# Project ADR policy
rg -i 'architecture decision|append.only|ADR' AGENTS.md CONTRIBUTING.md README.md docs/
```

---

## Operator prompts (short forms)

The user may resume a session with:

- `@skills/adr-backfill/SKILL.md` + pointer to code → run Phase 1
- "I'm aligned" / "inject it" after analysis → Phase 2 only
- "Next feature: …" → repeat subroutine from step 1

When ADR location or owning package is unclear, discover or ask before editing.
