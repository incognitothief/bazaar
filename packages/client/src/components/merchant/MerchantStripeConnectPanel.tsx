import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserApiUrl } from "@/lib/browserApi";
import { STRIPE_CONNECT_PANEL_ID } from "@/lib/stripeConnectScroll";
import { cn } from "@/lib/utils";

export type MerchantStripeSettings = {
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  secretKeySource: "env" | "database" | null;
  webhookSecretSource: "env" | "database" | null;
  canEditSecretKey: boolean;
  canEditWebhookSecret: boolean;
};

function sourceLabel(
  configured: boolean,
  source: "env" | "database" | null,
): string {
  if (!configured) return "Not set";
  if (source === "env") return "Environment variable";
  if (source === "database") return "Saved on server";
  return "—";
}

export function MerchantStripeConnectPanel({
  settings,
  loading,
  loadError,
  onUpdated,
}: {
  settings: MerchantStripeSettings | null;
  loading: boolean;
  loadError: string | null;
  onUpdated: () => void;
}) {
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const showForm =
    settings &&
    (settings.canEditSecretKey || settings.canEditWebhookSecret);

  const hasDbSecrets =
    settings &&
    (settings.secretKeySource === "database" ||
      settings.webhookSecretSource === "database");

  async function postSettings(body: Record<string, string | null>) {
    const res = await fetch(browserApiUrl("/api/merchant/stripe-settings"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; detail?: string }
      | null;
    if (!res.ok) {
      const parts = [j?.error, j?.detail].filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );
      throw new Error(parts.join(": ") || `HTTP ${res.status}`);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload: Record<string, string> = {};
    if (settings?.canEditSecretKey && secretKey.trim()) {
      payload.stripeSecretKey = secretKey.trim();
    }
    if (settings?.canEditWebhookSecret && webhookSecret.trim()) {
      payload.stripeWebhookSecret = webhookSecret.trim();
    }
    if (Object.keys(payload).length === 0) {
      setMsg({
        kind: "err",
        text: "Paste at least one new secret to save (secret key and/or webhook signing secret).",
      });
      return;
    }
    setSaving(true);
    try {
      await postSettings(payload);
      setSecretKey("");
      setWebhookSecret("");
      setMsg({ kind: "ok", text: "Saved." });
      onUpdated();
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearSaved() {
    setMsg(null);
    setClearing(true);
    try {
      const body: Record<string, string> = {};
      if (settings?.canEditSecretKey) body.stripeSecretKey = "";
      if (settings?.canEditWebhookSecret) body.stripeWebhookSecret = "";
      if (Object.keys(body).length === 0) return;
      await postSettings(body);
      setMsg({ kind: "ok", text: "Cleared saved secrets." });
      onUpdated();
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card id={STRIPE_CONNECT_PANEL_ID} className="mb-8 scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-lg">Stripe</CardTitle>
        <CardDescription>
          Checkout needs a Stripe secret key. Webhooks need a signing secret so the server can verify
          Stripe events. Environment variables take precedence over values saved here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : loadError ? (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        ) : !settings ? (
          <p className="text-sm text-muted-foreground">No Stripe settings loaded.</p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Secret key</dt>
                <dd className="font-medium">
                  {sourceLabel(
                    settings.secretKeyConfigured,
                    settings.secretKeySource,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Webhook signing secret</dt>
                <dd className="font-medium">
                  {sourceLabel(
                    settings.webhookSecretConfigured,
                    settings.webhookSecretSource,
                  )}
                </dd>
              </div>
            </dl>

            {!settings.canEditSecretKey ? (
              <p className="text-sm text-muted-foreground">
                <code className="text-xs">STRIPE_SECRET_KEY</code> is set on the server; unset it to
                manage the secret key from this form.
              </p>
            ) : null}
            {!settings.canEditWebhookSecret ? (
              <p className="text-sm text-muted-foreground">
                <code className="text-xs">STRIPE_WEBHOOK_SECRET</code> is set on the server; unset it
                to manage the webhook secret from this form.
              </p>
            ) : null}

            {showForm ? (
              <form onSubmit={handleSave} className="space-y-4 border-t border-border pt-4">
                {settings.canEditSecretKey ? (
                  <div className="space-y-2">
                    <Label htmlFor="stripe-secret-key">Stripe secret key</Label>
                    <Input
                      id="stripe-secret-key"
                      type="password"
                      autoComplete="off"
                      placeholder="sk_test_… or sk_live_…"
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                ) : null}
                {settings.canEditWebhookSecret ? (
                  <div className="space-y-2">
                    <Label htmlFor="stripe-webhook-secret">Webhook signing secret</Label>
                    <Input
                      id="stripe-webhook-secret"
                      type="password"
                      autoComplete="off"
                      placeholder="whsec_…"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  {hasDbSecrets ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={clearing}
                      onClick={() => void handleClearSaved()}
                    >
                      {clearing ? "Clearing…" : "Clear saved secrets"}
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : null}

            {msg ? (
              <p
                className={cn(
                  "text-sm",
                  msg.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
                )}
                role={msg.kind === "err" ? "alert" : undefined}
              >
                {msg.text}
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Saved keys are stored in the server database; protect{" "}
              <code className="text-[0.7rem]">DATABASE_PATH</code> and backups.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
