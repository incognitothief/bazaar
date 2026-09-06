import { useCallback, useEffect, useState } from "react";
import { AtUri } from "@atproto/syntax";
import { toast } from "sonner";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { useAtpSession } from "@/hooks/useAtpSession";
import { LicenseFormFull } from "@/components/merchant/LicenseFormFull";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/shared/Segmented";
import {
  createLicenseTerms,
  incrementLicenseVersion,
  listLicensesWithStatus,
  type LicenseListRow,
} from "@/lib/atproto/records";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { pdslsRecordUrl } from "@/lib/pdsls";

function ellipsizeMiddle(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function LicensePage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [rows, setRows] = useState<LicenseListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retireTarget, setRetireTarget] = useState<LicenseListRow | null>(
    null,
  );
  const [retiring, setRetiring] = useState(false);
  const [revivingCid, setRevivingCid] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "my-licenses">("editor");

  const refreshLicenses = useCallback(async () => {
    if (!agent || !session?.did) return;
    setLoading(true);
    try {
      const list = await listLicensesWithStatus(session.did);
      setRows(list);
    } finally {
      setLoading(false);
    }
  }, [agent, session?.did]);

  useEffect(() => {
    void refreshLicenses();
  }, [refreshLicenses]);

  async function confirmRetire() {
    if (!agent || !session?.did || !retireTarget) return;
    setRetiring(true);
    try {
      const at = new AtUri(retireTarget.uri);
      await agent.com.atproto.repo.deleteRecord({
        repo: session.did,
        collection: BAZAAR_COLLECTION.licenseTerms,
        rkey: at.rkey,
      });
      toast.success("License retired");
      setRetireTarget(null);
      await refreshLicenses();
    } catch (e) {
      toast.error("Failed to retire license", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRetiring(false);
    }
  }

  async function revive(row: LicenseListRow) {
    if (!agent) return;
    setRevivingCid(row.cid);
    try {
      const newVersion = incrementLicenseVersion(row.version);
      const created = await createLicenseTerms(agent, {
        title: row.title,
        version: newVersion,
        licenseText: row.licenseText,
        checkoutConsentRequired: row.checkoutConsentRequired,
      });
      toast.success(`Revived as version ${newVersion}`, {
        description: `${created.uri}\nCID: ${created.cid}`,
      });
      await refreshLicenses();
    } catch (e) {
      toast.error("Failed to revive license", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRevivingCid(null);
    }
  }

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

      <Segmented
        label="License view"
        value={tab}
        onChange={setTab}
        options={[
          { value: "editor", label: "License editor" },
          { value: "my-licenses", label: "My licenses" },
        ]}
      />

      {tab === "editor" ? (
        <div className="pt-4">
          <LicenseFormFull
            agent={agent}
            onLicensesChanged={() => void refreshLicenses()}
          />
        </div>
      ) : (
        <div className="pt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-4 py-6">
              No <code className="text-xs">license.terms</code> records yet.
              Write one in the License editor tab.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Version</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Record URI</th>
                    <th className="px-3 py-2 font-medium">CID</th>
                    <th className="px-3 py-2 font-medium">Captured</th>
                    <th className="px-3 py-2 font-medium"></th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.cid}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 align-top font-medium">
                        {r.title}
                      </td>
                      <td className="px-3 py-2 align-top text-muted-foreground">
                        {r.version}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Badge variant={r.retired ? "secondary" : "default"}>
                          {r.retired ? "Retired" : "Active"}
                        </Badge>
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
                        {r.capturedAt?.slice(0, 10) ?? "—"}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {r.retired ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={revivingCid === r.cid}
                            onClick={() => void revive(r)}
                          >
                            {revivingCid === r.cid ? "Reviving…" : "Revive"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRetireTarget(r)}
                          >
                            Retire
                          </Button>
                        )}
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
        </div>
      )}

      <Dialog
        open={!!retireTarget}
        onOpenChange={(open) => {
          if (!open) setRetireTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retire "{retireTarget?.title}"?</DialogTitle>
            <DialogDescription>
              Retiring removes this license from your public storefront.
              Buyers who already purchased under it can still view the
              terms — retiring never affects a completed sale. If you want
              to offer similar terms again later, create a new license with
              a new version rather than reusing this one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRetireTarget(null)}
              disabled={retiring}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmRetire()}
              disabled={retiring}
            >
              {retiring ? "Retiring…" : "Retire license"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
