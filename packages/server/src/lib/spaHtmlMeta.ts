import { AtUri } from "@atproto/syntax";
import { getAgentForDid } from "./atproto/resolvePds";
import { resolveCatalogItemUriFromRkey } from "./resolveCatalogItemUri";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

export function getPublicWebOrigin(): string {
  const u =
    process.env.PUBLIC_WEB_ORIGIN?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://127.0.0.1:3000";
  return u.replace(/\/$/, "");
}

function siteName(): string {
  return process.env.PUBLIC_SITE_NAME?.trim() || "Bazaar";
}

function defaultOgImageUrl(): string {
  const custom = process.env.PUBLIC_OG_DEFAULT_IMAGE?.trim();
  if (custom) return custom;
  return `${getPublicWebOrigin()}/og-default.png`;
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** First non-empty line of item description for link previews (matches client seo.ts). */
function firstLineForItemMeta(s: string | null | undefined): string | null {
  if (s == null) return null;
  const first = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return first ?? null;
}

function slugifyItemTitle(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "item";
}

async function getStorefrontOg(artistDid: string): Promise<{
  title: string;
  description: string;
}> {
  const DEFAULT_TITLE = "Storefront";
  const DEFAULT_DESC =
    "Music and releases from the artist catalog. Only items with an active listing are shown.";
  if (!artistDid.startsWith("did:")) {
    return { title: DEFAULT_TITLE, description: DEFAULT_DESC };
  }
  try {
    const agent = await getAgentForDid(artistDid);
    const res = await agent.com.atproto.repo.listRecords({
      repo: artistDid,
      collection: `${lexiconNs()}.actor.merchant`,
      limit: 1,
    });
    const row = res.data.records[0];
    const v = row?.value as
      | { displayName?: string; description?: string }
      | undefined;
    return {
      title: v?.displayName?.trim() || DEFAULT_TITLE,
      description: v?.description?.trim() || DEFAULT_DESC,
    };
  } catch {
    return { title: DEFAULT_TITLE, description: DEFAULT_DESC };
  }
}

async function getItemOg(
  itemUri: string,
): Promise<{ title: string; description: string | null } | null> {
  try {
    const at = new AtUri(itemUri);
    if (!at.rkey || !at.collection) return null;
    const agent = await getAgentForDid(at.hostname);
    const rec = await agent.com.atproto.repo.getRecord({
      repo: at.hostname,
      collection: at.collection,
      rkey: at.rkey,
    });
    const v = rec.data.value as { title?: string; description?: string };
    const title = typeof v.title === "string" ? v.title.trim() : "";
    if (!title) return null;
    const rawDesc = typeof v.description === "string" ? v.description : "";
    const description = firstLineForItemMeta(rawDesc);
    return { title, description };
  } catch {
    return null;
  }
}

function artworkSupportedCollection(collection: string): boolean {
  const ns = lexiconNs();
  return (
    collection === `${ns}.catalog.item.digital` ||
    collection === `${ns}.catalog.collection`
  );
}

function buildMetaBlock(opts: {
  title: string;
  description: string;
  canonicalUrl: string;
  ogType: "website" | "article";
  ogImage: string;
}): string {
  const tw = process.env.PUBLIC_TWITTER_SITE?.trim();
  const desc = trunc(opts.description, 300);
  const title = trunc(opts.title, 70);
  const lines = [
    `<title>${escAttr(title)}</title>`,
    `<meta name="description" content="${escAttr(trunc(desc, 160))}" />`,
    `<link rel="canonical" href="${escAttr(opts.canonicalUrl)}" />`,
    `<meta property="og:type" content="${opts.ogType}" />`,
    `<meta property="og:site_name" content="${escAttr(siteName())}" />`,
    `<meta property="og:title" content="${escAttr(title)}" />`,
    `<meta property="og:description" content="${escAttr(trunc(desc, 200))}" />`,
    `<meta property="og:url" content="${escAttr(opts.canonicalUrl)}" />`,
    `<meta property="og:image" content="${escAttr(opts.ogImage)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escAttr(title)}" />`,
    `<meta name="twitter:description" content="${escAttr(trunc(desc, 200))}" />`,
    `<meta name="twitter:image" content="${escAttr(opts.ogImage)}" />`,
  ];
  if (tw) {
    const handle = tw.startsWith("@") ? tw : `@${tw}`;
    lines.push(`<meta name="twitter:site" content="${escAttr(handle)}" />`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Build HTML fragment to inject into index.html for OG / Twitter / canonical.
 */
export async function buildSpaHeadFragment(pathname: string): Promise<string> {
  const origin = getPublicWebOrigin();
  const artistDid = process.env.ARTIST_DID?.trim() ?? "";
  const defImg = defaultOgImageUrl();

  if (pathname === "/" || pathname === "") {
    const { title, description } = await getStorefrontOg(artistDid);
    const pageTitle = `${title} · ${siteName()}`;
    const canonicalUrl = `${origin}/`;
    return buildMetaBlock({
      title: pageTitle,
      description,
      canonicalUrl,
      ogType: "website",
      ogImage: defImg,
    });
  }

  const itemMatch = pathname.match(/^\/item\/([^/]+)(?:\/([^/]+))?$/);
  if (itemMatch) {
    let rkey: string;
    try {
      rkey = decodeURIComponent(itemMatch[1]);
    } catch {
      return buildMetaBlock({
        title: siteName(),
        description: "Catalog item",
        canonicalUrl: `${origin}${pathname}`,
        ogType: "website",
        ogImage: defImg,
      });
    }
    if (rkey.startsWith("at://")) {
      return buildMetaBlock({
        title: siteName(),
        description: "Catalog item",
        canonicalUrl: `${origin}${pathname}`,
        ogType: "website",
        ogImage: defImg,
      });
    }
    if (!artistDid.startsWith("did:")) {
      return buildMetaBlock({
        title: siteName(),
        description: "Catalog item",
        canonicalUrl: `${origin}${pathname}`,
        ogType: "website",
        ogImage: defImg,
      });
    }
    const itemUri = await resolveCatalogItemUriFromRkey(artistDid, rkey);
    if (!itemUri) {
      return buildMetaBlock({
        title: `Item · ${siteName()}`,
        description: "This item could not be loaded.",
        canonicalUrl: `${origin}${pathname}`,
        ogType: "website",
        ogImage: defImg,
      });
    }
    const fields = await getItemOg(itemUri);
    const titleText = fields?.title ?? "Item";
    const descText =
      fields?.description ?? `Available on ${siteName()}.`;
    let at: AtUri;
    try {
      at = new AtUri(itemUri);
    } catch {
      return buildMetaBlock({
        title: `${titleText} · ${siteName()}`,
        description: descText,
        canonicalUrl: `${origin}${pathname}`,
        ogType: "article",
        ogImage: defImg,
      });
    }
    const slugSeg = itemMatch[2]
      ? decodeURIComponent(itemMatch[2])
      : slugifyItemTitle(titleText);
    const canonicalPath = `/item/${encodeURIComponent(rkey)}/${encodeURIComponent(slugSeg)}`;
    const canonicalUrl = `${origin}${canonicalPath}`;

    const ogImage = artworkSupportedCollection(at.collection)
      ? `${origin}/api/inventory-public/artwork-open?itemUri=${encodeURIComponent(itemUri)}`
      : defImg;

    return buildMetaBlock({
      title: `${titleText} · ${siteName()}`,
      description: descText,
      canonicalUrl,
      ogType: "article",
      ogImage,
    });
  }

  const canonicalUrl = `${origin}${pathname === "" ? "/" : pathname}`;
  return buildMetaBlock({
    title: siteName(),
    description: siteName(),
    canonicalUrl,
    ogType: "website",
    ogImage: defImg,
  });
}

export async function injectSpaHead(html: string, pathname: string): Promise<string> {
  const fragment = await buildSpaHeadFragment(pathname);
  const marker = "<!-- __BAZAAR_HEAD__ -->";
  if (html.includes(marker)) {
    return html.replace(marker, fragment);
  }
  return html.replace("</head>", `${fragment}</head>`);
}
