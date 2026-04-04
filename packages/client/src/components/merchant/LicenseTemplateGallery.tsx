import { useState } from "react";
import {
  LICENSE_TEMPLATE_COMPLEXITY_META,
  LICENSE_TEMPLATE_COMPLEXITY_ORDER,
  licenseTemplatesForComplexity,
  type LicenseTemplateComplexity,
  type LicenseTemplateId,
} from "@bazaar/shared";
import { Button } from "@/components/ui/button";
import {
  createLicenseTerms,
  findLicenseByTemplateId,
  licenseTermsPayloadFromTemplateId,
} from "@/lib/atproto/records";
import type { ATPRepoClient } from "@/lib/atproto/session";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function LicenseTemplateGallery({ agent }: { agent: ATPRepoClient }) {
  const [selectedId, setSelectedId] = useState<LicenseTemplateId | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveSelected() {
    if (!selectedId) {
      toast.error("Choose a license template");
      return;
    }
    const did = agent.session?.did;
    if (!did) return;
    setSaving(true);
    try {
      const existing = await findLicenseByTemplateId(agent, did, selectedId);
      if (existing) {
        toast.message("Already on your PDS", {
          description: existing.uri,
        });
        return;
      }
      const payload = licenseTermsPayloadFromTemplateId(selectedId);
      if (!payload) {
        toast.error("Unknown template");
        return;
      }
      await createLicenseTerms(agent, payload);
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
    <div className={cn("space-y-10", selectedId && "pb-24 sm:pb-28")}>
      {LICENSE_TEMPLATE_COMPLEXITY_ORDER.map(
        (complexity: LicenseTemplateComplexity) => {
          const meta = LICENSE_TEMPLATE_COMPLEXITY_META[complexity];
          const templates = licenseTemplatesForComplexity(complexity);
          return (
            <section key={complexity} className="space-y-4">
              <div className="space-y-1 border-b border-border pb-3">
                <h2 className="text-lg font-semibold tracking-tight">
                  {meta.label}
                </h2>
                <p className="text-sm text-muted-foreground max-w-3xl">
                  {meta.description}
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((def) => {
                  const selected = selectedId === def.id;
                  return (
                    <li key={def.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setSelectedId((cur) =>
                            cur === def.id ? null : def.id,
                          )
                        }
                        className={cn(
                          "flex h-full w-full flex-col rounded-lg border p-4 text-left transition-colors",
                          "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected && "ring-2 ring-ring bg-muted/30",
                        )}
                      >
                        <span className="font-medium leading-snug">
                          {def.record.title}
                        </span>
                        {def.record.summary ? (
                          <span className="mt-2 text-sm text-muted-foreground leading-relaxed">
                            {def.record.summary}
                          </span>
                        ) : null}
                        <span className="mt-3 text-xs text-muted-foreground border-t border-border/60 pt-3 leading-relaxed">
                          <span className="font-medium text-foreground/80">
                            Before you choose:{" "}
                          </span>
                          {def.guidance}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        },
      )}

      <div
        key={selectedId ? "footer-dock" : "footer-inline"}
        className={cn(
          "flex flex-wrap items-center gap-3 border-t border-border",
          selectedId
            ? cn(
                "fixed bottom-0 left-0 right-0 z-40 border-border bg-background/95 px-4 py-3 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.15)] backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 sm:px-6 md:left-56 md:px-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
                "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-6 motion-safe:duration-300 motion-safe:ease-out motion-safe:fill-mode-both",
              )
            : "pt-6",
        )}
      >
        <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={saving || !selectedId}
              onClick={() => void saveSelected()}
            >
              {saving ? "Saving…" : "Save selected template to PDS"}
            </Button>
            {selectedId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear license selection"
                onClick={() => setSelectedId(null)}
              >
                Clear
              </Button>
            ) : null}
          </div>
          {selectedId ? (
            <p className="text-xs text-muted-foreground">
              &nbsp;&nbsp;Selected:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">
                {selectedId}
              </code>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
