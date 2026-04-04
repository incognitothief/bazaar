export {
  BAZAAR_LEXICON_DOCS,
  BAZAAR_LEXICON_IDS,
  lexicons,
} from "./lexicons/docs.js";
export { validateBazaarRecord } from "./lexicons/validate.js";
export type {
  LicenseTemplateComplexity,
  LicenseTemplateDefinition,
  LicenseTemplateId,
  LicenseTemplateRecord,
} from "./license-templates/registry.js";
export {
  getLicenseTemplateDefinition,
  licenseRecordMatchesTemplate,
  LICENSE_TEMPLATE_COMPLEXITY_META,
  LICENSE_TEMPLATE_COMPLEXITY_ORDER,
  LICENSE_TEMPLATE_DEFINITIONS,
  LICENSE_TEMPLATE_IDS,
  licenseTemplatesForComplexity,
  stripLicenseTemplateType,
} from "./license-templates/registry.js";
