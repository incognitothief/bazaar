import Stripe from "stripe";
import type { Db } from "../../db";
import { resolveStripeSecretKey } from "./stripeCredentials";

export async function getStripe(db: Db): Promise<Stripe | null> {
  const key = await resolveStripeSecretKey(db);
  if (!key) return null;
  return new Stripe(key);
}
