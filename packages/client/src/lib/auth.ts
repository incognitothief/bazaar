export type AuthRole = "merchant" | "customer";

function artistDid(): string {
  const raw = import.meta.env.VITE_ARTIST_DID;
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * Merchant console access: session DID must equal `VITE_ARTIST_DID` (store owner).
 * OAuth and mock sessions both use this same rule.
 */
export function getAuthRole(did: string | null | undefined): AuthRole {
  const owner = artistDid();
  if (!did || !owner.startsWith("did:")) return "customer";
  return did === owner ? "merchant" : "customer";
}
