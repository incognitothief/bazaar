/**
 * UI-only content classification for `catalog.item` records. Nothing here is
 * stored or sent to the PDS -- `category` stays the freeform seller string it
 * already is; this module only decides how to *shape* the page around it.
 *
 * Resolution order (see `resolveContentClass`):
 *   1. the merchant's `category`, normalized and looked up in CATEGORY_DICTIONARY
 *   2. the uploaded file's immutable `format` (extension)
 *   3. "generic" -- neutral layout, the blank/unassigned fallback
 *
 * Only the macro categories are ever offered in the editor selector. The
 * dictionary is deliberately broad so a merchant can type whatever fits their
 * catalog ("sample pack", "brush pack", "notion template") and still land on a
 * sensible page shape.
 */
export type ContentClass =
  | "audio"
  | "video"
  | "graphic"
  | "document"
  | "software"
  | "bundle"
  | "generic";

/** The categories offered as options in the editor selector. */
export const MACRO_CATEGORIES = [
  "audio",
  "video",
  "graphic",
  "document",
  "software",
  "bundle",
] as const;
export type MacroCategory = (typeof MACRO_CATEGORIES)[number];

const AUDIO_FORMATS = new Set([
  "flac",
  "wav",
  "wave",
  "mp3",
  "aac",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "aiff",
  "aif",
  "alac",
  "wma",
]);

const GRAPHIC_FORMATS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "tiff",
  "tif",
  "bmp",
  "heic",
  "heif",
  "avif",
  "psd",
  "ai",
  "eps",
]);

const DOCUMENT_FORMATS = new Set([
  "pdf",
  "epub",
  "mobi",
  "doc",
  "docx",
  "txt",
  "md",
  "markdown",
  "rtf",
  "odt",
  "pages",
  "tex",
]);

const VIDEO_FORMATS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "3gp",
  "ogv",
  "mts",
]);

const BUNDLE_FORMATS = new Set([
  "zip",
  "rar",
  "7z",
  "gz",
  "tgz",
  "tar",
  "bz2",
  "xz",
  "zst",
  "zipx",
]);

const SOFTWARE_FORMATS = new Set([
  "exe",
  "msi",
  "dmg",
  "pkg",
  "apk",
  "aab",
  "deb",
  "rpm",
  "appimage",
  "snap",
  "flatpak",
  "jar",
  "bin",
  "iso",
]);

/**
 * Lowercased freeform category -> macro class. Broad on purpose; the editor only
 * surfaces the three macro values but accepts anything a merchant types.
 */
const CATEGORY_DICTIONARY: Record<string, MacroCategory> = {
  // audio
  audio: "audio",
  track: "audio",
  song: "audio",
  single: "audio",
  album: "audio",
  ep: "audio",
  beat: "audio",
  instrumental: "audio",
  acapella: "audio",
  stem: "audio",
  stems: "audio",
  loop: "audio",
  "loop kit": "audio",
  "drum kit": "audio",
  "drum loop": "audio",
  sample: "audio",
  "sample pack": "audio",
  "sound kit": "audio",
  "sound pack": "audio",
  "sound effect": "audio",
  sfx: "audio",
  foley: "audio",
  oneshot: "audio",
  "one shot": "audio",
  preset: "audio",
  patch: "audio",
  soundbank: "audio",
  "sound bank": "audio",
  podcast: "audio",
  audiobook: "audio",
  voiceover: "audio",
  "voice over": "audio",
  ringtone: "audio",
  music: "audio",
  midi: "audio",
  // graphic
  graphic: "graphic",
  image: "graphic",
  art: "graphic",
  artwork: "graphic",
  illustration: "graphic",
  photo: "graphic",
  photograph: "graphic",
  photography: "graphic",
  brush: "graphic",
  "brush pack": "graphic",
  texture: "graphic",
  "texture pack": "graphic",
  pattern: "graphic",
  wallpaper: "graphic",
  background: "graphic",
  icon: "graphic",
  "icon pack": "graphic",
  "icon set": "graphic",
  logo: "graphic",
  mockup: "graphic",
  "mockup pack": "graphic",
  vector: "graphic",
  clipart: "graphic",
  "clip art": "graphic",
  sticker: "graphic",
  "sticker pack": "graphic",
  font: "graphic",
  typeface: "graphic",
  lut: "graphic",
  "lightroom preset": "graphic",
  "photoshop action": "graphic",
  "3d model": "graphic",
  "asset pack": "graphic",
  // document
  document: "document",
  doc: "document",
  pdf: "document",
  ebook: "document",
  "e-book": "document",
  book: "document",
  guide: "document",
  tutorial: "document",
  course: "document",
  lesson: "document",
  template: "document",
  "notion template": "document",
  worksheet: "document",
  planner: "document",
  checklist: "document",
  cheatsheet: "document",
  "cheat sheet": "document",
  script: "document",
  screenplay: "document",
  transcript: "document",
  whitepaper: "document",
  "white paper": "document",
  report: "document",
  zine: "document",
  comic: "document",
  magazine: "document",
  manual: "document",
  spreadsheet: "document",
  presentation: "document",
  slides: "document",
  "slide deck": "document",
  resume: "document",
  "cover letter": "document",
  contract: "document",
  // video
  video: "video",
  "video file": "video",
  movie: "video",
  film: "video",
  clip: "video",
  "video clip": "video",
  footage: "video",
  "stock footage": "video",
  broll: "video",
  "b-roll": "video",
  "b roll": "video",
  animation: "video",
  "motion graphics": "video",
  "motion graphic": "video",
  screencast: "video",
  "screen recording": "video",
  vlog: "video",
  reel: "video",
  "video tutorial": "video",
  "video course": "video",
  "video lesson": "video",
  "video template": "video",
  "video preset": "video",
  "video pack": "video",
  "video loop": "video",
  visualizer: "video",
  cinemagraph: "video",
  "title sequence": "video",
  "lower thirds": "video",
  "transition pack": "video",
  // software
  software: "software",
  app: "software",
  application: "software",
  "web app": "software",
  "mobile app": "software",
  "desktop app": "software",
  plugin: "software",
  "plug-in": "software",
  vst: "software",
  vst3: "software",
  au: "software",
  aax: "software",
  "audio unit": "software",
  extension: "software",
  "browser extension": "software",
  addon: "software",
  "add-on": "software",
  tool: "software",
  "cli tool": "software",
  program: "software",
  executable: "software",
  installer: "software",
  binary: "software",
  game: "software",
  "game build": "software",
  mod: "software",
  "game mod": "software",
  modpack: "software",
  rom: "software",
  firmware: "software",
  "source code": "software",
  codebase: "software",
  code: "software",
  library: "software",
  framework: "software",
  sdk: "software",
  api: "software",
  boilerplate: "software",
  scaffold: "software",
  "starter kit": "software",
  "starter template": "software",
  "starter project": "software",
  theme: "software",
  "wordpress theme": "software",
  "wordpress plugin": "software",
  "shopify theme": "software",
  "shopify app": "software",
  "figma plugin": "software",
  widget: "software",
  "shell script": "software",
  automation: "software",
  macro: "software",
  workflow: "software",
  "alfred workflow": "software",
  "raycast extension": "software",
  "obsidian plugin": "software",
  dotfiles: "software",
  config: "software",
  snippet: "software",
  "code snippet": "software",
  component: "software",
  // bundle
  bundle: "bundle",
  archive: "bundle",
  "asset bundle": "bundle",
  "resource pack": "bundle",
  "content pack": "bundle",
  "starter pack": "bundle",
  "mega pack": "bundle",
  megapack: "bundle",
  "bundle pack": "bundle",
  "file bundle": "bundle",
  "zip file": "bundle",
  compressed: "bundle",
  "download pack": "bundle",
  "value pack": "bundle",
  "bonus pack": "bundle",
  "complete pack": "bundle",
  "full pack": "bundle",
  collection: "bundle",
};

/**
 * Strips a bitrate/quality suffix (`mp3-320`, `wav_24bit`) down to the leading
 * token so it doesn't fall through to "generic".
 */
function baseToken(format: string): string {
  return format.trim().toLowerCase().split(/[-_ /]/)[0] ?? "";
}

export function contentClassFromFormat(
  format: string | null | undefined,
): ContentClass {
  if (!format) return "generic";
  const token = baseToken(format);
  if (!token) return "generic";
  if (AUDIO_FORMATS.has(token)) return "audio";
  if (VIDEO_FORMATS.has(token)) return "video";
  if (GRAPHIC_FORMATS.has(token)) return "graphic";
  if (DOCUMENT_FORMATS.has(token)) return "document";
  if (SOFTWARE_FORMATS.has(token)) return "software";
  if (BUNDLE_FORMATS.has(token)) return "bundle";
  return "generic";
}

/** Lowercase, trimmed, internal whitespace collapsed -- the dictionary key form. */
export function normalizeCategory(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Macro class a freeform category resolves to, or null if unrecognized. */
export function categoryMacroClass(
  category: string | null | undefined,
): MacroCategory | null {
  const key = normalizeCategory(category);
  if (!key) return null;
  return CATEGORY_DICTIONARY[key] ?? null;
}

/** Format-derived macro suggestion for editor prefill; null when unrecognized. */
export function suggestedMacroFromFormat(
  format: string | null | undefined,
): MacroCategory | null {
  const cls = contentClassFromFormat(format);
  return cls === "generic" ? null : cls;
}

/**
 * Page shape for a `catalog.item`: category first (when it maps to a macro
 * class), then the uploaded file's format, then generic.
 */
export function resolveContentClass(input: {
  category?: string | null;
  format?: string | null;
}): ContentClass {
  return (
    categoryMacroClass(input.category) ?? contentClassFromFormat(input.format)
  );
}

type ContentClassCopy = {
  /** null for "generic" -- nothing worth showing. */
  label: string | null;
  /** Noun for "download this ___" / "Your ___" copy. */
  noun: string;
};

const COPY: Record<ContentClass, ContentClassCopy> = {
  audio: { label: "Audio", noun: "audio file" },
  video: { label: "Video", noun: "video" },
  graphic: { label: "Graphic", noun: "image" },
  document: { label: "Document", noun: "document" },
  software: { label: "Software", noun: "software" },
  bundle: { label: "Bundle", noun: "bundle" },
  generic: { label: null, noun: "item" },
};

export function contentClassCopy(cls: ContentClass): ContentClassCopy {
  return COPY[cls];
}
