/**
 * Per-productType onboarding customization. productType is ERP-only (see
 * catalogProducts.productType) -- it never touches the PDS record, so
 * adding a new type here never requires a lexicon or migration change.
 * "generic" is the universal fallback for any type this build doesn't (yet)
 * recognize, so old and new deployments degrade gracefully together.
 */
export type ProductType = "music" | "generic";

export const GENERIC_PRODUCT_TYPE: ProductType = "generic";

type ProductTypeConfig = {
  value: ProductType;
  label: string;
  description: string;
  /** Default for the "include cover art in the download" toggle at creation time -- merchant can still override. */
  defaultArtIncludedInDownload: boolean;
};

const PRODUCT_TYPE_CONFIGS: Record<ProductType, ProductTypeConfig> = {
  music: {
    value: "music",
    label: "Music release",
    description: "An album, EP, or single.",
    defaultArtIncludedInDownload: true,
  },
  generic: {
    value: "generic",
    label: "Generic",
    description: "Anything else -- software, art, documents, bundles.",
    defaultArtIncludedInDownload: false,
  },
};

/** All configs, for rendering a picker. */
export const PRODUCT_TYPE_OPTIONS: ProductTypeConfig[] = Object.values(
  PRODUCT_TYPE_CONFIGS,
);

/** Falls back to generic for null/unset/unrecognized values (e.g. a future type this build predates). */
export function productTypeConfig(type: string | null | undefined): ProductTypeConfig {
  return (
    PRODUCT_TYPE_CONFIGS[type as ProductType] ?? PRODUCT_TYPE_CONFIGS[GENERIC_PRODUCT_TYPE]
  );
}
