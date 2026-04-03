import { useState } from "react";
import type { Agent } from "@atproto/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createLicenseTerms,
  findLicenseByTemplateKey,
  LICENSE_TEMPLATES,
  type LicenseTemplateKey,
} from "@/lib/atproto/records";
import { toast } from "sonner";

export function LicensePickerSimple({ agent }: { agent: Agent }) {
  const [key, setKey] = useState<LicenseTemplateKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!key) {
      toast.error("Choose a template");
      return;
    }
    const did = agent.session?.did;
    if (!did) return;
    setSaving(true);
    try {
      const existing = await findLicenseByTemplateKey(agent, did, key);
      if (existing) {
        toast.message("Already saved", {
          description: existing.uri,
        });
        return;
      }
      const t = LICENSE_TEMPLATES[key];
      await createLicenseTerms(agent, {
        title: t.title,
        tier: t.tier,
        rightsType: t.rightsType,
        version: t.version,
        territoryCoverage: { ...t.territoryCoverage },
        usageRestrictions: t.usageRestrictions
          ? { ...t.usageRestrictions }
          : undefined,
        checkoutConsentRequired: t.checkoutConsentRequired,
        humanReadableUrl: t.humanReadableUrl,
        summary: t.summary,
      });
      toast.success("License terms saved to your repo");
    } catch (e) {
      toast.error("Failed to save license", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {(Object.keys(LICENSE_TEMPLATES) as LicenseTemplateKey[]).map((k) => {
          const t = LICENSE_TEMPLATES[k];
          return (
            <Card
              key={k}
              className={key === k ? "ring-2 ring-ring" : ""}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>{t.summary}</p>
                <Button
                  type="button"
                  variant={key === k ? "default" : "outline"}
                  size="sm"
                  className="mt-3"
                  onClick={() => setKey(k)}
                >
                  Select
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Button disabled={saving || !key} onClick={() => void save()}>
        {saving ? "Saving…" : "Save to PDS"}
      </Button>
    </div>
  );
}
