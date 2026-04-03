import { parseBlob } from "music-metadata";

export type ParsedAudioMeta = {
  durationMs: number;
  format: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  isrc?: string;
};

function normalizeFormat(
  mime: string | undefined,
  ext: string,
  fromMeta: string | undefined,
): string {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("flac")) return "flac";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("aac") || m.includes("mp4")) return "aac";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  const e = ext.replace(/^\./, "").toLowerCase();
  if (["flac", "mp3", "wav", "aac", "ogg", "m4a", "opus"].includes(e))
    return e === "m4a" ? "aac" : e === "opus" ? "ogg" : e;
  const meta = (fromMeta ?? "").toLowerCase();
  if (meta && meta !== "unknown") return meta;
  return "unknown";
}

export async function parseAudioFile(file: File): Promise<ParsedAudioMeta> {
  const metadata = await parseBlob(file);
  const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : "";
  const format = normalizeFormat(file.type, ext, metadata.format.container);

  const common = metadata.common;
  const isrc =
    common.isrc?.[0] ??
    (typeof common.isrc === "string" ? common.isrc : undefined);

  return {
    durationMs,
    format,
    bitrate: metadata.format.bitrate,
    sampleRate: metadata.format.sampleRate,
    channels: metadata.format.numberOfChannels,
    title: common.title,
    artist: common.artist?.[0] ?? common.artists?.[0],
    album: common.album,
    trackNumber: common.track?.no ?? undefined,
    isrc,
  };
}
