import { AtUri } from "@atproto/syntax";

export function catalogItemRkey(itemUri: string): string {
  const a = new AtUri(itemUri);
  if (!a.rkey) throw new Error("Invalid item AT-URI");
  return a.rkey;
}

/** Slug for optional trailing URL segment (cosmetic only). */
export function slugifyItemTitle(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "item";
}

export function itemPathCanonical(rkey: string): string {
  return `/item/${encodeURIComponent(rkey)}`;
}

export function itemPathPretty(rkey: string, title: string | undefined): string {
  const base = itemPathCanonical(rkey);
  if (!title?.trim()) return base;
  return `${base}/${encodeURIComponent(slugifyItemTitle(title))}`;
}
