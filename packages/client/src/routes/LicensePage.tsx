import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { useAtpSession } from "@/hooks/useAtpSession";
import { LicenseTemplateGallery } from "@/components/merchant/LicenseTemplateGallery";

export function LicensePage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  if (!session || !agent) return null;

  return (
    <div className="w-full min-w-0 max-w-5xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">License templates</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Each template is a full{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            license.terms
          </code>{" "}
          record. Templates are grouped by how much you and your buyers need to
          understand to use them well — from everyday paid downloads to sync,
          broadcast, and Creative Commons public grants.
        </p>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Save a template to your PDS once; uploads and listings can reference
          it by URI. If a matching record already exists (same title, version,
          tier, and rights type), we reuse it instead of creating a duplicate.
        </p>
      </div>
      <LicenseTemplateGallery agent={agent} />
    </div>
  );
}
