import broadcast from "./broadcast.json" with { type: "json" };
import ccBy4 from "./cc-by-4.json" with { type: "json" };
import ccByNc4 from "./cc-by-nc-4.json" with { type: "json" };
import ccByNcNd4 from "./cc-by-nc-nd-4.json" with { type: "json" };
import ccByNcSa4 from "./cc-by-nc-sa-4.json" with { type: "json" };
import ccBySa4 from "./cc-by-sa-4.json" with { type: "json" };
import commercialDerivativesMaster from "./commercial-derivatives-master.json" with { type: "json" };
import commercialMasterOnly from "./commercial-master-only.json" with { type: "json" };
import mechanical from "./mechanical.json" with { type: "json" };
import personalUse from "./personal-use.json" with { type: "json" };
import personalUseAttribution from "./personal-use-attribution.json" with { type: "json" };
import stemLicense from "./stem-license.json" with { type: "json" };
import syncFullClearance from "./sync-full-clearance.json" with { type: "json" };
import syncMasterOnly from "./sync-master-only.json" with { type: "json" };
import syncPublishingOnly from "./sync-publishing-only.json" with { type: "json" };

/** How much context the merchant (and often the buyer) must understand to use the template responsibly. */
export type LicenseTemplateComplexity =
  | "simple"
  | "moderate"
  | "advanced"
  | "creativeCommons";

export type LicenseTemplateId =
  | "personal-use"
  | "personal-use-attribution"
  | "commercial-master-only"
  | "commercial-derivatives-master"
  | "stem-license"
  | "sync-master-only"
  | "sync-publishing-only"
  | "sync-full-clearance"
  | "broadcast"
  | "mechanical"
  | "cc-by-4"
  | "cc-by-nc-4"
  | "cc-by-nc-nd-4"
  | "cc-by-sa-4"
  | "cc-by-nc-sa-4";

/** Canonical on-disk JSON for a `license.terms` template (`createdAt` added at write time). */
export type LicenseTemplateRecord = {
  $type: "diamonds.whereditgo.bazaar.license.terms";
  title: string;
  tier: string;
  rightsType: string;
  version: string;
  territoryCoverage: { scope: string; territories?: string[] };
  checkoutConsentRequired: boolean;
  usageRestrictions?: Record<string, boolean | undefined>;
  summary?: string;
  humanReadableUrl?: string;
  term?: { durationMonths?: number; expiresAt?: string };
  proNotice?: Record<string, string | undefined>;
  legalMetadata?: Record<string, string | number | undefined>;
  editionSize?: number;
};

export type LicenseTemplateDefinition = {
  id: LicenseTemplateId;
  complexity: LicenseTemplateComplexity;
  /** What you should understand before offering this license to buyers. */
  guidance: string;
  record: LicenseTemplateRecord;
};

const RAW: readonly (Omit<LicenseTemplateDefinition, "record"> & {
  record: unknown;
})[] = [
  {
    id: "personal-use",
    complexity: "simple",
    guidance:
      "No extra configuration — the default paid personal-listening grant. Buyers confirm terms at checkout.",
    record: personalUse,
  },
  {
    id: "personal-use-attribution",
    complexity: "simple",
    guidance:
      "Like personal use, but buyers must credit you when they share or reference the work in public.",
    record: personalUseAttribution,
  },
  {
    id: "commercial-master-only",
    complexity: "moderate",
    guidance:
      "Buyers may monetize the recording; they remain responsible for composition / publishing clearance.",
    record: commercialMasterOnly,
  },
  {
    id: "commercial-derivatives-master",
    complexity: "moderate",
    guidance:
      "Adds remix and edit rights on the master. Publishing is still on the buyer — set expectations in your listing copy.",
    record: commercialDerivativesMaster,
  },
  {
    id: "stem-license",
    complexity: "moderate",
    guidance:
      "For stem packs: buyers may build new commercial works from stems; attribution stays required.",
    record: stemLicense,
  },
  {
    id: "sync-master-only",
    complexity: "advanced",
    guidance:
      "Sync on the recording only — buyers still clear publishing. Often paired with project disclosure at checkout.",
    record: syncMasterOnly,
  },
  {
    id: "sync-publishing-only",
    complexity: "advanced",
    guidance:
      "Composition-side sync only; buyers must license the master elsewhere. Best when you control publishing, not the recording.",
    record: syncPublishingOnly,
  },
  {
    id: "sync-full-clearance",
    complexity: "advanced",
    guidance:
      "You are offering both master and publishing for sync in one sale — only choose if you truly control both stacks.",
    record: syncFullClearance,
  },
  {
    id: "broadcast",
    complexity: "advanced",
    guidance:
      "Radio, TV, and platform broadcast; mechanical reporting applies. Buyers need a clear picture of performance obligations.",
    record: broadcast,
  },
  {
    id: "mechanical",
    complexity: "advanced",
    guidance:
      "Cover-version / new-recording right on the composition only — not your original master. Buyers record their own version.",
    record: mechanical,
  },
  {
    id: "cc-by-4",
    complexity: "creativeCommons",
    guidance:
      "Very permissive public grant. Best for free or pay-what-you-want; pairing with strict paid exclusives is legally awkward.",
    record: ccBy4,
  },
  {
    id: "cc-by-nc-4",
    complexity: "creativeCommons",
    guidance:
      "Non-commercial sharing and remixes only. Buyers still need to understand NC boundaries for commercial projects.",
    record: ccByNc4,
  },
  {
    id: "cc-by-nc-nd-4",
    complexity: "creativeCommons",
    guidance:
      "Share verbatim, non-commercially, with credit — no remixes. Easiest CC to explain to casual downloaders.",
    record: ccByNcNd4,
  },
  {
    id: "cc-by-sa-4",
    complexity: "creativeCommons",
    guidance:
      "Copyleft: derivatives must stay under CC BY-SA. Buyers who build on the work need to understand share-alike.",
    record: ccBySa4,
  },
  {
    id: "cc-by-nc-sa-4",
    complexity: "creativeCommons",
    guidance:
      "Non-commercial copyleft — derivatives stay NC+SA. Good for community remix culture without commercial fork.",
    record: ccByNcSa4,
  },
] as const;

export const LICENSE_TEMPLATE_DEFINITIONS: readonly LicenseTemplateDefinition[] =
  RAW.map((row) => ({
    ...row,
    record: row.record as LicenseTemplateRecord,
  }));

export const LICENSE_TEMPLATE_IDS = LICENSE_TEMPLATE_DEFINITIONS.map(
  (d) => d.id,
) as unknown as readonly LicenseTemplateId[];

export const LICENSE_TEMPLATE_COMPLEXITY_ORDER: readonly LicenseTemplateComplexity[] =
  ["simple", "moderate", "advanced", "creativeCommons"];

export const LICENSE_TEMPLATE_COMPLEXITY_META: Record<
  LicenseTemplateComplexity,
  { label: string; description: string }
> = {
  simple: {
    label: "Simple",
    description:
      "Straightforward paid licenses — few follow-up questions from buyers if your listing matches the template.",
  },
  moderate: {
    label: "Moderate",
    description:
      "Commercial use on the master; buyers often must clear publishing or understand remix boundaries themselves.",
  },
  advanced: {
    label: "Advanced",
    description:
      "Sync, broadcast, or mechanical grants — split rights, PRO reporting, and project context matter.",
  },
  creativeCommons: {
    label: "Creative Commons",
    description:
      "Public licenses for the world — ideal for free or pay-what-you-want. Checkout clickwrap is off; CC + paid listings needs deliberate messaging.",
  },
};

export function getLicenseTemplateDefinition(
  id: string,
): LicenseTemplateDefinition | undefined {
  return LICENSE_TEMPLATE_DEFINITIONS.find((d) => d.id === id);
}

export function licenseTemplatesForComplexity(
  complexity: LicenseTemplateComplexity,
): readonly LicenseTemplateDefinition[] {
  return LICENSE_TEMPLATE_DEFINITIONS.filter((d) => d.complexity === complexity);
}

/** Payload for PDS `createRecord` / `createLicenseTerms` (no `$type` — caller adds `$type` + `createdAt`). */
export function stripLicenseTemplateType(
  record: LicenseTemplateRecord,
): Omit<LicenseTemplateRecord, "$type"> {
  const { $type: _t, ...rest } = record;
  return rest;
}

/**
 * Match dedupe per alignment: `title` + `version` + `tier` + `rightsType`.
 * Pass a license record value from the PDS (with those fields).
 */
export function licenseRecordMatchesTemplate(
  value: {
    title?: string;
    version?: string;
    tier?: string;
    rightsType?: string;
  },
  def: LicenseTemplateDefinition,
): boolean {
  const r = def.record;
  return (
    value.title === r.title &&
    value.version === r.version &&
    value.tier === r.tier &&
    value.rightsType === r.rightsType
  );
}
