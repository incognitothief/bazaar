export type AuthRole = "merchant" | "customer";

function envDid(name: string): string {
  const raw = (import.meta.env as Record<string, unknown>)[name];
  if (typeof raw !== "string") return "";
  return raw.trim();
}

const MERCHANT_DIDS = [
  envDid("VITE_ARTIST_DID"),
  envDid("VITE_APP_DID"),
].filter((d) => d.startsWith("did:"));

export function getAuthRole(did: string | null | undefined): AuthRole {
  if (!did) return "customer";
  return MERCHANT_DIDS.includes(did) ? "merchant" : "customer";
}

