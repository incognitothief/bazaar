/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ATPROTO_SERVICE: string;
  readonly VITE_APP_DID: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_APP_URL: string;
  readonly VITE_LEXICON_NAMESPACE: string;
  readonly VITE_ARTIST_DID: string;
  readonly VITE_API_ORIGIN: string;
  /** When "true" in dev, sign-in skips OAuth and uses localStorage mock (see useAtpSession). */
  readonly VITE_DEV_MOCK_ATPROTO_SIGNIN?: string;
  /** Optional override DID for mock merchant session (defaults to VITE_ARTIST_DID then VITE_APP_DID). */
  readonly VITE_DEV_MOCK_MERCHANT_DID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
