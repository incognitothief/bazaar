/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ATPROTO_SERVICE: string;
  readonly VITE_APP_DID: string;
  readonly VITE_APP_URL: string;
  readonly VITE_LEXICON_NAMESPACE: string;
  readonly VITE_ARTIST_DID: string;
  readonly VITE_API_ORIGIN: string;
  /** When "true" in dev, sign-in skips OAuth and uses localStorage mock (see useAtpSession). */
  readonly VITE_DEV_MOCK_ATPROTO_SIGNIN?: string;
  /** Override item AT-URI for the empty-state dummy row on Listings (dev / VITE_SHOW_LISTINGS_DUMMY). */
  readonly VITE_DEV_DUMMY_ITEM_URI?: string;
  /** When "true", show the Listings dummy row even outside Vite dev (e.g. preview). */
  readonly VITE_SHOW_LISTINGS_DUMMY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
