/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MERCHANT_DID: string;
  /** When "true" in dev, sign-in skips OAuth and uses localStorage mock (see useAtpSession.tsx). */
  readonly VITE_DEV_MOCK_ATPROTO_SIGNIN?: string;
  /** Override item AT-URI for the empty-state dummy row on Listings (dev / VITE_SHOW_LISTINGS_DUMMY). */
  readonly VITE_DEV_DUMMY_ITEM_URI?: string;
  /** When "true", show the Listings dummy row even outside Vite dev (e.g. preview). */
  readonly VITE_SHOW_LISTINGS_DUMMY?: string;
  /** Contact email on /terms and /refunds (defaults if unset). */
  readonly VITE_CONTACT_EMAIL?: string;
  /** Public product name for `<title>` / `og:site_name` (whitelabel). */
  readonly VITE_PUBLIC_SITE_NAME?: string;
  /** Absolute URL for default `og:image` when item art is missing. */
  readonly VITE_PUBLIC_OG_DEFAULT_IMAGE?: string;
  /** Twitter @handle for `twitter:site` (no @ required). */
  readonly VITE_PUBLIC_TWITTER_SITE?: string;
  /**
   * Repository the footer's "Source Code" link points at. Defaults to upstream Bazaar.
   * Set this to your own repository if you modify Bazaar and run it as a network
   * service — AGPL-3.0 section 13 requires offering users the source of *that* version.
   */
  readonly VITE_SOURCE_URL?: string;
  /** Commit the build came from, so the source link resolves to the exact revision. */
  readonly VITE_SOURCE_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
