import { useMemo } from "react";
import type {
  Collection,
  CompletenessScore,
  DigitalItem,
} from "@/types/lexicons";

export type CompletenessSubject = Partial<DigitalItem | Collection> & {
  hasAudioFile?: boolean;
  /** When false for a track, a catalog.recording link is missing (rights metadata). */
  hasLinkedRecording?: boolean;
};

function isCollectionShape(
  x: CompletenessSubject,
): x is Partial<Collection> & CompletenessSubject {
  return x.$type === "diamonds.whereditgo.bazaar.catalog.collection";
}

/**
 * Scores 0–100. Only core catalog identity + structure count as "required";
 * artwork, genre, description, UPC, ISRC, license URI, and per-item artwork
 * contribute via recommended/optional buckets and do not empty the required list
 * for publish-style gates (those live on the upload flow separately).
 */
export function scoreCompleteness(item: CompletenessSubject): CompletenessScore {
  const reqKeys: string[] = [];
  const recKeys: string[] = [];
  const optKeys: string[] = [];

  if (isCollectionShape(item)) {
    if (!item.title) reqKeys.push("title");
    if (!item.artistDid) reqKeys.push("artistDid");
    if (!item.releaseDate) reqKeys.push("releaseDate");
    if (!item.items?.length) reqKeys.push("items");

    if (!item.artworkCid) recKeys.push("artwork");
    if (!item.description?.trim()) recKeys.push("description");
    if (!item.genre?.length) recKeys.push("genre");

    if (!item.upc?.trim()) optKeys.push("upc");

    const nReq = 4;
    const nRec = 3;
    const nOpt = 1;
    const perReq = 70 / nReq;
    const perRec = 20 / nRec;
    const perOpt = 10 / nOpt;
    const score = Math.min(
      100,
      Math.round(
        (nReq - reqKeys.length) * perReq +
          (nRec - recKeys.length) * perRec +
          (nOpt - optKeys.length) * perOpt,
      ),
    );
    return {
      score,
      required: reqKeys,
      recommended: recKeys,
      optional: optKeys,
    };
  }

  if (!item.title) reqKeys.push("title");
  if (!item.artistDid) reqKeys.push("artistDid");
  if (!item.itemClass) reqKeys.push("itemClass");
  if (!item.formats?.length) reqKeys.push("formats");
  if (!item.hasAudioFile) reqKeys.push("audioFile");
  if (!item.fileChecksum || !item.fileCid) reqKeys.push("fileIntegrity");

  if (!item.description?.trim()) recKeys.push("description");
  if (!item.genre?.length) recKeys.push("genre");
  if (!item.releaseDate) recKeys.push("releaseDate");
  if (item.itemClass === "track" && item.hasLinkedRecording === false) {
    recKeys.push("ownershipRecords");
  }

  if (!item.isrc?.trim()) optKeys.push("isrc");

  const nReq = 6;
  const nRec = item.itemClass === "track" ? 4 : 3;
  const nOpt = 1;
  const perReq = 55 / nReq;
  const perRec = 30 / nRec;
  const perOpt = 15 / nOpt;
  const score = Math.min(
    100,
    Math.round(
      (nReq - reqKeys.length) * perReq +
        (nRec - recKeys.length) * perRec +
        (nOpt - optKeys.length) * perOpt,
    ),
  );

  return {
    score,
    required: reqKeys,
    recommended: recKeys,
    optional: optKeys,
  };
}

export function useCompletenessScore(
  item: CompletenessSubject,
): CompletenessScore {
  return useMemo(() => scoreCompleteness(item), [item]);
}
