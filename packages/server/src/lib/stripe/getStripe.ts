import Stripe from "stripe";

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("PLACEHOLDER")) return null;
  return new Stripe(key);
}
