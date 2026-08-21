import ccBy4 from "./cc-by-4.json" with { type: "json" };
import ccByNc4 from "./cc-by-nc-4.json" with { type: "json" };
import ccByNcNd4 from "./cc-by-nc-nd-4.json" with { type: "json" };
import ccByNcSa4 from "./cc-by-nc-sa-4.json" with { type: "json" };
import ccBySa4 from "./cc-by-sa-4.json" with { type: "json" };
import commercialUse from "./commercial-use.json" with { type: "json" };
import personalUse from "./personal-use.json" with { type: "json" };

/** How much context the merchant (and often the buyer) must understand to use the template responsibly. */
export type LicenseTemplateComplexity = "simple" | "creativeCommons";

export type LicenseTemplateId =
  | "personal-use"
  | "commercial-use"
  | "cc-by-4"
  | "cc-by-nc-4"
  | "cc-by-nc-nd-4"
  | "cc-by-sa-4"
  | "cc-by-nc-sa-4";

/** Canonical on-disk JSON for a `license.terms` template (`createdAt` added at write time). */
export type LicenseTemplateRecord = {
  $type: "diamonds.whereditgo.bazaar.license.terms";
  title: string;
  version: string;
  licenseText: string;
  checkoutConsentRequired: boolean;
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
      "No extra configuration — the default paid personal-use grant. Buyers confirm terms at checkout.",
    record: personalUse,
  },
  {
    id: "commercial-use",
    complexity: "simple",
    guidance:
      "Buyers may use the work commercially. Review the text and adjust it if you need to carve out rights you don't actually hold.",
    record: commercialUse,
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
  ["simple", "creativeCommons"];

export const LICENSE_TEMPLATE_COMPLEXITY_META: Record<
  LicenseTemplateComplexity,
  { label: string; description: string }
> = {
  simple: {
    label: "Simple",
    description:
      "Starter contracts you can use as-is or edit freely before saving — few follow-up questions from buyers if your listing matches the text.",
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
 * Dedupe match: `title` + `version`. Once a merchant edits a template's text
 * in the document editor, it's a distinct license even if title/version
 * happen to match — this is intentionally a light heuristic, not identity.
 * Pass a license record value from the PDS (with those fields).
 */
export function licenseRecordMatchesTemplate(
  value: {
    title?: string;
    version?: string;
  },
  def: LicenseTemplateDefinition,
): boolean {
  const r = def.record;
  return value.title === r.title && value.version === r.version;
}
