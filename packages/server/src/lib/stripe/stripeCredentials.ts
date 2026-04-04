import { eq } from "drizzle-orm";
import type { Db } from "../../db";
import { merchantStripeConfig } from "../../db/schema";

function envStripeSecretKey(): string | null {
  const k = process.env.STRIPE_SECRET_KEY?.trim();
  if (!k || k.includes("PLACEHOLDER")) return null;
  return k;
}

function envStripeWebhookSecret(): string | null {
  const k = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!k || k.includes("PLACEHOLDER")) return null;
  return k;
}

export function stripeSecretKeyFromEnv(): boolean {
  return envStripeSecretKey() != null;
}

export function stripeWebhookSecretFromEnv(): boolean {
  return envStripeWebhookSecret() != null;
}

export async function resolveStripeSecretKey(db: Db): Promise<string | null> {
  const env = envStripeSecretKey();
  if (env) return env;
  const row = db
    .select()
    .from(merchantStripeConfig)
    .where(eq(merchantStripeConfig.singleton, 1))
    .get();
  const k = row?.stripeSecretKey?.trim();
  return k && k.length > 0 ? k : null;
}

export async function resolveStripeWebhookSecret(db: Db): Promise<string | null> {
  const env = envStripeWebhookSecret();
  if (env) return env;
  const row = db
    .select()
    .from(merchantStripeConfig)
    .where(eq(merchantStripeConfig.singleton, 1))
    .get();
  const k = row?.stripeWebhookSecret?.trim();
  return k && k.length > 0 ? k : null;
}

export async function stripeCredentialSources(db: Db): Promise<{
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  secretKeySource: "env" | "database" | null;
  webhookSecretSource: "env" | "database" | null;
}> {
  const envSk = envStripeSecretKey();
  const envWh = envStripeWebhookSecret();
  const row = db
    .select()
    .from(merchantStripeConfig)
    .where(eq(merchantStripeConfig.singleton, 1))
    .get();
  const dbSk = row?.stripeSecretKey?.trim();
  const dbWh = row?.stripeWebhookSecret?.trim();
  const secretKeyConfigured = !!(envSk || (dbSk && dbSk.length > 0));
  const webhookSecretConfigured = !!(envWh || (dbWh && dbWh.length > 0));
  return {
    secretKeyConfigured,
    webhookSecretConfigured,
    secretKeySource: envSk ? "env" : dbSk && dbSk.length > 0 ? "database" : null,
    webhookSecretSource: envWh ? "env" : dbWh && dbWh.length > 0 ? "database" : null,
  };
}

function looksLikeStripeSecretKey(s: string): boolean {
  return (
    (s.startsWith("sk_test_") ||
      s.startsWith("sk_live_") ||
      s.startsWith("rk_test_") ||
      s.startsWith("rk_live_")) &&
    s.length >= 20
  );
}

function looksLikeStripeWebhookSecret(s: string): boolean {
  return s.startsWith("whsec_") && s.length >= 20;
}

export function validateStripeSecretKeyInput(s: string): string | null {
  const t = s.trim();
  if (!t) return "Secret key is required";
  if (!looksLikeStripeSecretKey(t)) return "Expected a Stripe secret key (sk_… or rk_…)";
  return null;
}

export function validateStripeWebhookSecretInput(s: string): string | null {
  const t = s.trim();
  if (!t) return "Webhook signing secret is required";
  if (!looksLikeStripeWebhookSecret(t)) return "Expected a Stripe webhook secret (whsec_…)";
  return null;
}
