import { useCallback, useEffect, useState } from "react";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { useAtpSession } from "@/hooks/useAtpSession";
import { LicenseTemplateGallery } from "@/components/merchant/LicenseTemplateGallery";
import {
  listLicenseTermsRows,
  type LicenseTermsRow,
} from "@/lib/atproto/records";

function ellipsizeMiddle(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function LicensePage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [rows, setRows] = useState<LicenseTermsRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshLicenses = useCallback(async () => {
    if (!agent || !session?.did) return;
    setLoading(true);
    try {
      const list = await listLicenseTermsRows(agent, session.did);
      setRows(list);
    } finally {
      setLoading(false);
    }
  }, [agent, session?.did]);

  useEffect(() => {
    void refreshLicenses();
  }, [refreshLicenses]);

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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Saved on your PDS
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-4 py-6">
            No <code className="text-xs">license.terms</code> records yet.
            Pick a template below and save it to your repo.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium">Rights</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Record URI</th>
                  <th className="px-3 py-2 font-medium">CID</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.uri}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 align-top font-medium">
                      {r.terms.title}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {r.terms.tier}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {r.terms.rightsType}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {r.terms.version}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <code
                        className="text-[0.7rem] break-all text-muted-foreground"
                        title={r.uri}
                      >
                        {ellipsizeMiddle(r.uri, 28, 12)}
                      </code>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <code
                        className="text-[0.7rem] break-all text-muted-foreground"
                        title={r.cid}
                      >
                        {ellipsizeMiddle(r.cid, 10, 8)}
                      </code>
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground whitespace-nowrap">
                      {r.terms.createdAt?.slice(0, 10) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <LicenseTemplateGallery
        agent={agent}
        onLicensesChanged={() => void refreshLicenses()}
      />
    </div>
  );
}
