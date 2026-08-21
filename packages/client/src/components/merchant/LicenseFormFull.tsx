import { useState } from "react";
import { toast } from "sonner";
import { LICENSE_TEMPLATE_DEFINITIONS } from "@bazaar/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createLicenseTerms } from "@/lib/atproto/records";
import type { ATPRepoClient } from "@/lib/atproto/session";
import { cn } from "@/lib/utils";

export function LicenseFormFull({
  agent,
  onLicensesChanged,
}: {
  agent: ATPRepoClient;
  onLicensesChanged?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("1.0");
  const [licenseText, setLicenseText] = useState("");
  const [checkoutConsentRequired, setCheckoutConsentRequired] =
    useState(true);
  const [saving, setSaving] = useState(false);
  const [startedFrom, setStartedFrom] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && licenseText.trim().length > 0;

  function startFromTemplate(id: string) {
    const def = LICENSE_TEMPLATE_DEFINITIONS.find((d) => d.id === id);
    if (!def) return;
    setTitle(def.record.title);
    setVersion(def.record.version);
    setLicenseText(def.record.licenseText);
    setCheckoutConsentRequired(def.record.checkoutConsentRequired);
    setStartedFrom(id);
  }

  async function save() {
    if (!canSave) {
      toast.error("Give the license a title and write the license text");
      return;
    }
    setSaving(true);
    try {
      const created = await createLicenseTerms(agent, {
        title: title.trim(),
        version: version.trim() || "1.0",
        licenseText: licenseText.trim(),
        checkoutConsentRequired,
      });
      toast.success("License terms saved to your repo", {
        description: `${created.uri}\nCID: ${created.cid}`,
      });
      setTitle("");
      setVersion("1.0");
      setLicenseText("");
      setCheckoutConsentRequired(true);
      setStartedFrom(null);
      onLicensesChanged?.();
    } catch (e) {
      toast.error("Failed to save license", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Write your license</h3>
        <p className="text-sm text-muted-foreground">
          What you write here is exactly what buyers will read and agree to
          at checkout.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Start from a template (optional)</Label>
        <div className="flex flex-wrap gap-2">
          {LICENSE_TEMPLATE_DEFINITIONS.map((def) => (
            <button
              key={def.id}
              type="button"
              onClick={() => startFromTemplate(def.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                startedFrom === def.id
                  ? "border-ring bg-muted/60"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {def.record.title}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="license-title">Title</Label>
          <Input
            id="license-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Personal Use"
            maxLength={256}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="license-version">Version</Label>
          <Input
            id="license-version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0"
            maxLength={32}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="license-text">License text</Label>
        <Textarea
          id="license-text"
          value={licenseText}
          onChange={(e) => setLicenseText(e.target.value)}
          placeholder="Describe what the buyer may and may not do with this work..."
          rows={10}
          maxLength={20000}
        />
      </div>

      <div className="flex items-start gap-2">
        <input
          id="license-consent-required"
          type="checkbox"
          checked={checkoutConsentRequired}
          onChange={(e) => setCheckoutConsentRequired(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-input"
        />
        <Label
          htmlFor="license-consent-required"
          className="font-normal leading-snug"
        >
          Require buyers to affirmatively agree to this license at checkout
        </Label>
      </div>

      <Button disabled={saving || !canSave} onClick={() => void save()}>
        {saving ? "Saving…" : "Save license to your repo"}
      </Button>
    </div>
  );
}
