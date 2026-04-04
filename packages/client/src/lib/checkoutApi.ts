import { browserApiUrl } from "@/lib/browserApi";

/** POST target for Stripe Checkout (same-origin in dev so Vite proxy applies). */
export function stripeCheckoutPostUrl(): string {
  return browserApiUrl("/api/stripe/checkout");
}
