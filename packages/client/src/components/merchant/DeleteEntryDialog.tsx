import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteCatalogEntry,
  fetchDeletionManifest,
  type DeletionManifest,
} from "@/lib/api/catalogDeleteApi";

type Props = {
  /** AT-URI of the entry to delete; null closes the dialog. */
  entryUri: string | null;
  onClose: () => void;
  onDeleted: (manifest: DeletionManifest) => void;
};

/**
 * Hard gate for permanent catalog deletion.
 *
 * Three things have to be true before the destructive button enables: the
 * manifest loaded, nothing is blocking, and the merchant typed the entry's
 * exact title. The manifest shown here is advisory -- the server rebuilds it
 * on submit, so a listing created while this dialog sat open still blocks.
 *
 * NOTE: warning copy below is boilerplate pending a wording pass.
 */
export function DeleteEntryDialog({ entryUri, onClose, onDeleted }: Props) {
  const [manifest, setManifest] = useState<DeletionManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryUri) {
      setManifest(null);
      setConfirmText("");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDeletionManifest(entryUri)
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryUri]);

  const blocked = !!manifest && manifest.blockers.length > 0;
  const confirmed = !!manifest && confirmText.trim() === manifest.title;
  const canDelete = !!manifest && !blocked && confirmed && !deleting;

  async function onConfirm() {
    if (!entryUri || !manifest) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCatalogEntry(entryUri, confirmText.trim());
      toast.success(`"${manifest.title}" permanently deleted`);
      onDeleted(manifest);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Delete failed — nothing was removed", { description: msg });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={!!entryUri}
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Permanently delete {manifest ? `"${manifest.title}"` : "this entry"}?
          </DialogTitle>
          <DialogDescription>
            This cannot be undone. The records are removed from your PDS and the
            files are erased from storage. There is no backup, no trash, and no
            recovery path — once this completes, the only way to restore
            anything is to upload it again from your own copies.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-muted-foreground text-sm">Calculating what will be deleted…</p>
        )}

        {manifest && (
          <div className="min-w-0 space-y-4 text-sm">
            {blocked && (
              <div className="border-destructive/40 bg-destructive/10 rounded-md border p-3">
                <p className="font-medium">Remove these listings first</p>
                <p className="text-muted-foreground mt-1">
                  Deletion is blocked while this entry is still listed for sale.
                  Unlist it, then come back.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {manifest.blockers.map((b) => (
                    <li key={b.uri} className="min-w-0">
                      <span className="text-muted-foreground text-xs">
                        Listing ({b.status}) still points at
                      </span>
                      <span className="text-muted-foreground block break-all font-mono text-xs">
                        {b.targetUri}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {manifest.receiptCount > 0 && (
              <div className="border-destructive/40 bg-destructive/10 rounded-md border p-3">
                <p className="font-medium">
                  {manifest.receiptCount} buyer
                  {manifest.receiptCount === 1 ? "" : "s"} own this
                </p>
                <p className="text-muted-foreground mt-1">
                  Their purchase receipts stay in their own repositories, but the
                  files those receipts point to will be gone. Their downloads
                  will break permanently and cannot be restored.
                </p>
              </div>
            )}

            <section>
              <p className="font-medium">
                Records to delete ({manifest.pdsRecords.length})
              </p>
              <ul className="text-muted-foreground mt-1 space-y-0.5">
                {manifest.pdsRecords.map((r) => (
                  <li key={r.uri} className="break-all text-xs">
                    {r.label}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <p className="font-medium">Files to erase ({manifest.r2Objects.length})</p>
              {manifest.r2Objects.length === 0 ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  No stored files resolved for this entry.
                </p>
              ) : (
                <ul className="text-muted-foreground mt-1 space-y-0.5">
                  {manifest.r2Objects.map((o) => (
                    <li key={o.key} className="break-all text-xs">
                      {o.label}
                      {o.source === "recomputed" && (
                        <span className="text-destructive"> — unindexed</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {manifest.sharedItemsSkipped.length > 0 && (
              <section>
                <p className="font-medium">
                  Kept ({manifest.sharedItemsSkipped.length})
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Still used by another product, so they are not deleted:
                </p>
                <ul className="text-muted-foreground mt-1 space-y-0.5">
                  {manifest.sharedItemsSkipped.map((s) => (
                    <li key={s.uri} className="break-all font-mono text-xs">
                      {s.uri}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!blocked && (
              <div className="space-y-2">
                <Label htmlFor="delete-confirm">
                  Type <span className="break-all font-mono font-semibold">{manifest.title}</span> to
                  confirm
                </Label>
                <Input
                  id="delete-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  disabled={deleting}
                />
              </div>
            )}
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!canDelete}>
            {deleting ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
