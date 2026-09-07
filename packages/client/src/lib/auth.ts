export type AuthRole = "merchant" | "customer";

function merchantDid(): string {
  const raw = import.meta.env.VITE_MERCHANT_DID;
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * Merchant console access: session DID must equal `VITE_MERCHANT_DID` (store owner).
 * OAuth and mock sessions both use this same rule.
 */
export function getAuthRole(did: string | null | undefined): AuthRole {
  const owner = merchantDid();
  if (!did || !owner.startsWith("did:")) return "customer";
  return did === owner ? "merchant" : "customer";
}
