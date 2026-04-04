import { useMemo } from "react";
import type {
  Collection,
  CompletenessScore,
  DigitalItem,
} from "@/types/lexicons";

export type CompletenessSubject = Partial<DigitalItem | Collection> & {
  hasAudioFile?: boolean;
};

function isCollectionShape(
  x: CompletenessSubject,
): x is Partial<Collection> & CompletenessSubject {
  return x.$type === "diamonds.whereditgo.bazaar.catalog.collection";
}

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
    if (!("description" in item) || !item.description)
      recKeys.push("description");
    if (!item.genre?.length) recKeys.push("genre");
    if (!item.upc) optKeys.push("upc");
    if (!item.defaultLicenseUri) optKeys.push("defaultLicenseUri");

    const nReq = 4;
    const nRec = 3;
    const nOpt = 2;
    const perReq = 60 / nReq;
    const perRec = 25 / nRec;
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

  if (!item.title) reqKeys.push("title");
  if (!item.artistDid) reqKeys.push("artistDid");
  if (!item.itemClass) reqKeys.push("itemClass");
  if (!item.formats?.length) reqKeys.push("formats");
  if (!item.hasAudioFile) reqKeys.push("audioFile");
  if (!item.fileChecksum || !item.fileCid) reqKeys.push("fileIntegrity");
  if (!item.artworkCid) recKeys.push("artwork");
  if (!("description" in item) || !item.description)
    recKeys.push("description");
  if (!item.genre?.length) recKeys.push("genre");
  if (!item.releaseDate) recKeys.push("releaseDate");
  if (!item.isrc) optKeys.push("isrc");
  if (!item.defaultLicenseUri) optKeys.push("defaultLicenseUri");
  const pro = (
    item as { legalMetadata?: { proMembership?: string } }
  ).legalMetadata?.proMembership;
  if (!pro) optKeys.push("proMembership");

  const nReq = 6;
  const nRec = 4;
  const nOpt = 4;
  const perReq = 60 / nReq;
  const perRec = 25 / nRec;
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
