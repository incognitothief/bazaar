/**
 * Prefixed tag tokens -- structured attributes carried inside the freeform
 * `tags[]` array on catalog.item / catalog.product, with no lexicon change.
 *
 * A tag shaped `key:value` (lowercase key) is a token; anything else is a plain
 * label. `id:` tokens take an optional identifier subtype -- `id:isrc:US-...`,
 * `id:upc:012...` -- so every external identifier lives under the one `id`
 * group rather than as its own prefix. Grouping is display-only; storage stays
 * the flat `string[]`, so `["genre:jazz"]` <-> `{ genre: ["jazz"] }` round-trips
 * if a real key/value field is ever added.
 */

export type ParsedTag =
  | { kind: "plain"; raw: string; value: string }
  | {
      kind: "token";
      raw: string;
      key: string;
      /** Only ever set for `id:` tokens (e.g. "isrc", "upc"). */
      subtype: string | null;
      value: string;
    };

const KEY_RE = /^([a-z][a-z0-9_-]*):(.+)$/i;

export function parseTag(raw: string): ParsedTag {
  const trimmed = raw.trim();
  const m = trimmed.match(KEY_RE);
  if (!m) return { kind: "plain", raw: trimmed, value: trimmed };
  const key = m[1].toLowerCase();
  const rest = m[2].trim();
  if (key === "id") {
    const sub = rest.match(KEY_RE);
    if (sub) {
      return {
        kind: "token",
        raw: trimmed,
        key: "id",
        subtype: sub[1].toLowerCase(),
        value: sub[2].trim(),
      };
    }
    return { kind: "token", raw: trimmed, key: "id", subtype: null, value: rest };
  }
  return { kind: "token", raw: trimmed, key, subtype: null, value: rest };
}

export type TokenEntry = { subtype: string | null; value: string; raw: string };

export type TagGroup = { key: string; label: string; entries: TokenEntry[] };

export type GroupedTags = {
  /** Known keys first (in KNOWN_ORDER), then unknown keys in first-seen order. */
  groups: TagGroup[];
  plain: string[];
};

type KnownToken = {
  label: string;
  /** Renders a single entry for display. */
  formatEntry: (entry: TokenEntry) => string;
  /** At most one of these may exist on a record; the editor blocks further ones. */
  singular?: boolean;
};

/** `2024-03-01` / `2024/3/1` / `2024-03` / `2024` -> `2024/03/01` etc. Passthrough if it isn't a date. */
function formatReleased(entry: TokenEntry): string {
  const m = entry.value.match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/);
  if (!m) return entry.value;
  const [, y, mo, d] = m;
  const parts = [y];
  if (mo) parts.push(mo.padStart(2, "0"));
  if (d) parts.push(d.padStart(2, "0"));
  return parts.join("/");
}

function formatId(entry: TokenEntry): string {
  return entry.subtype
    ? `${entry.subtype.toUpperCase()} ${entry.value}`
    : entry.value;
}

export const KNOWN_TOKENS: Record<string, KnownToken> = {
  released: { label: "Released", formatEntry: formatReleased, singular: true },
  genre: { label: "Genre", formatEntry: (e) => e.value },
  id: { label: "ID", formatEntry: formatId },
};

const KNOWN_ORDER = ["released", "genre", "id"];

/** Prefixes offered as quick-add affordances in the tag editor. */
export const TOKEN_PREFIXES = ["genre:", "released:", "id:"];

export function groupTags(tags: string[] | null | undefined): GroupedTags {
  const byKey = new Map<string, TokenEntry[]>();
  const plain: string[] = [];
  for (const t of tags ?? []) {
    const p = parseTag(t);
    if (p.kind === "plain") {
      if (p.value) plain.push(p.value);
      continue;
    }
    const arr = byKey.get(p.key) ?? [];
    arr.push({ subtype: p.subtype, value: p.value, raw: p.raw });
    byKey.set(p.key, arr);
  }
  const orderedKeys = [
    ...KNOWN_ORDER.filter((k) => byKey.has(k)),
    ...[...byKey.keys()].filter((k) => !KNOWN_ORDER.includes(k)),
  ];
  return {
    groups: orderedKeys.map((key) => ({
      key,
      label: KNOWN_TOKENS[key]?.label ?? key,
      entries: byKey.get(key)!,
    })),
    plain,
  };
}

export function formatTokenEntry(key: string, entry: TokenEntry): string {
  return KNOWN_TOKENS[key]?.formatEntry(entry) ?? entry.value;
}
