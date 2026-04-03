import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { useAtpSession } from "@/hooks/useAtpSession";
import { LicensePickerSimple } from "@/components/merchant/LicensePickerSimple";

export function LicensePage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  if (!session || !agent) return null;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">License templates</h1>
      <p className="text-sm text-muted-foreground">
        Pre-create license terms on your PDS so uploads can reference them.
      </p>
      <LicensePickerSimple agent={agent} />
    </div>
  );
}
