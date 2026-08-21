import { useCallback, useEffect, useState } from "react";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { useAtpSession } from "@/hooks/useAtpSession";
import { LicenseFormFull } from "@/components/merchant/LicenseFormFull";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listLicenseTermsRows,
  type LicenseTermsRow,
} from "@/lib/atproto/records";
import { pdslsRecordUrl } from "@/lib/pdsls";

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
      const list = await listLicenseTermsRows(session.did);
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
    <div className="w-full min-w-0 max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Licenses</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Licenses are purchase agreements that outline the terms of a sale.
          This document is saved to your PDS as a{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            license.terms
          </code>{" "}
          record. You can write your own license, or start from a template.
        </p>
      </div>

      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">License editor</TabsTrigger>
          <TabsTrigger value="my-licenses">My licenses</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="pt-4">
          <LicenseFormFull
            agent={agent}
            onLicensesChanged={() => void refreshLicenses()}
          />
        </TabsContent>

        <TabsContent value="my-licenses" className="pt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-4 py-6">
              No <code className="text-xs">license.terms</code> records yet.
              Write one in the License editor tab.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Version</th>
                    <th className="px-3 py-2 font-medium">Record URI</th>
                    <th className="px-3 py-2 font-medium">CID</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium"></th>
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
                        {r.terms.version}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {(() => {
                          const href = pdslsRecordUrl(r.uri);
                          const label = ellipsizeMiddle(r.uri, 28, 12);
                          if (!href) {
                            return (
                              <code
                                className="text-[0.7rem] break-all text-muted-foreground"
                                title={r.uri}
                              >
                                {label}
                              </code>
                            );
                          }
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[0.7rem] break-all font-mono text-primary underline-offset-2 hover:underline"
                              title={r.uri}
                            >
                              {label}
                            </a>
                          );
                        })()}
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
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <a
                          href={`/license/${encodeURIComponent(r.cid)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Inspect
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
