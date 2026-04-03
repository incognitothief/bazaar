/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ATPROTO_SERVICE: string;
  readonly VITE_APP_DID: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_APP_URL: string;
  readonly VITE_LEXICON_NAMESPACE: string;
  readonly VITE_ARTIST_DID: string;
  readonly VITE_API_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
