const FALLBACK_CONTACT_EMAIL = "support@example.com";

/**
 * Build-time contact when business email is not used. Set `VITE_CONTACT_EMAIL` in production.
 */
export function publicContactEmail(): string {
  return import.meta.env.VITE_CONTACT_EMAIL?.trim() || FALLBACK_CONTACT_EMAIL;
}

/**
 * Contact address for legal copy on /terms and /refunds: business email from the API when set,
 * otherwise {@link publicContactEmail} (avoids showing the placeholder when business email exists).
 */
export function resolveLegalContactEmail(
  businessEmail: string | null | undefined,
): string {
  const b = businessEmail?.trim() ?? "";
  if (b.length > 0) return b;
  return publicContactEmail();
}
