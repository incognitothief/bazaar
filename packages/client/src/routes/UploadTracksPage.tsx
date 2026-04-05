import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createInventorySession,
  type PublishInventorySnapshot,
  publishInventorySession,
  registerInventoryObjects,
  saveInventoryDraft,
  uploadFileToInventoryObject,
} from "@/lib/api/inventoryApi";
import { listLicenseTermsRows, type LicenseTermsRow } from "@/lib/atproto/records";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { cn } from "@/lib/utils";
import type { DigitalItem } from "@/types/lexicons";

const ITEM_CLASSES: DigitalItem["itemClass"][] = [
  "track",
  "album",
  "samplePack",
  "preset",
  "stems",
  "video",
  "document",
  "ebook",
  "other",
];

type RegRow = {
  file: File;
  objectId: string;
  uploadKind: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

export function UploadTracksPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RegRow[]>([]);
  const [artworkObjectId, setArtworkObjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [licenseRows, setLicenseRows] = useState<LicenseTermsRow[]>([]);
  const [savedLicense, setSavedLicense] = useState<{
    uri: string;
    cid: string;
  } | null>(null);
  const [price, setPrice] = useState("9.99");
  const [itemClass, setItemClass] = useState<DigitalItem["itemClass"]>("track");
  const [collectionMode, setCollectionMode] = useState(false);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [publishDone, setPublishDone] = useState<{
    snap: PublishInventorySnapshot;
    listingPrefillPath: string;
  } | null>(null);

  useEffect(() => {
    if (!agent || !session?.did) return;
    let cancelled = false;
    void listLicenseTermsRows(agent, session.did)
      .then((r) => {
        if (!cancelled) setLicenseRows(r);
      })
      .catch(() => {
        if (!cancelled) setLicenseRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, session?.did]);

  const startSession = useCallback(async () => {
    setBusy(true);
    try {
      const { sessionId: sid } = await createInventorySession("digital");
      setSessionId(sid);
      toast.success("Session started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setBusy(false);
    }
  }, []);

  const registerAndUpload = useCallback(async () => {
    if (!sessionId) {
      toast.error("Start a session first");
      return;
    }
    if (files.length === 0) {
      toast.error("Choose one or more audio files");
      return;
    }
    setBusy(true);
    try {
      const objects: Array<{
        slotId: string;
        fileName: string;
        contentType?: string;
        byteSize: number;
        role: "master" | "artwork";
      }> = files.map((f) => ({
        slotId: crypto.randomUUID(),
        fileName: f.name,
        contentType: f.type || undefined,
        byteSize: f.size,
        role: "master" as const,
      }));
      if (artworkFile) {
        objects.push({
          slotId: crypto.randomUUID(),
          fileName: artworkFile.name,
          contentType: artworkFile.type || undefined,
          byteSize: artworkFile.size,
          role: "artwork",
        });
      }
      const reg = await registerInventoryObjects(sessionId, objects);
      const masterRegs = reg.objects.slice(0, files.length);
      const artReg =
        artworkFile && reg.objects.length > files.length
          ? reg.objects[files.length]
          : null;
      setArtworkObjectId(artReg?.objectId ?? null);

      const nextRows: RegRow[] = files.map((file, i) => ({
        file,
        objectId: masterRegs[i]!.objectId,
        uploadKind: masterRegs[i]!.uploadKind,
        status: "pending",
      }));
      setRows(nextRows);

      for (let i = 0; i < nextRows.length; i++) {
        const row = nextRows[i]!;
        setRows((prev) =>
          prev.map((r, j) =>
            j === i ? { ...r, status: "uploading" as const } : r,
          ),
        );
        try {
          await uploadFileToInventoryObject(
            row.objectId,
            row.file,
            row.uploadKind,
          );
          setRows((prev) =>
            prev.map((r, j) =>
              j === i ? { ...r, status: "done" as const } : r,
            ),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setRows((prev) =>
            prev.map((r, j) =>
              j === i
                ? { ...r, status: "error" as const, error: msg }
                : r,
            ),
          );
          throw err;
        }
      }

      if (artworkFile && artReg) {
        await uploadFileToInventoryObject(
          artReg.objectId,
          artworkFile,
          artReg.uploadKind,
        );
      }

      toast.success("Uploads complete — add metadata and publish");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [sessionId, files, artworkFile]);

  const publish = useCallback(async () => {
    if (!sessionId) return;
    if (!savedLicense) {
      toast.error("Select a license from your PDS");
      return;
    }
    if (rows.length === 0 || rows.some((r) => r.status !== "done")) {
      toast.error("Finish uploads first");
      return;
    }
    if (rows.length > 1 && !collectionMode) {
      toast.error("Multiple files require collection mode");
      return;
    }
    if (collectionMode && !collectionTitle.trim()) {
      toast.error("Collection title required");
      return;
    }
    const draft = {
      tracks: rows.map((r, i) => ({
        objectId: r.objectId,
        title: titles[i]?.trim() || r.file.name.replace(/\.[^.]+$/, ""),
        itemClass,
        formats: [] as string[],
        ...(artworkObjectId && !collectionMode && i === 0
          ? { artworkObjectId }
          : {}),
      })),
      collection:
        collectionMode && rows.length > 1
          ? {
              title: collectionTitle.trim(),
              trackObjectIds: rows.map((r) => r.objectId),
              ...(artworkObjectId ? { artworkObjectId } : {}),
            }
          : undefined,
      licenseUri: savedLicense.uri,
      licenseGrantCid: savedLicense.cid,
    };

    setBusy(true);
    try {
      await saveInventoryDraft(sessionId, draft);
      const snap = await publishInventorySession(sessionId);
      const params = new URLSearchParams({
        prefillItemUri: snap.primaryItemUri,
        priceUsd: price,
        licenseUri: savedLicense.uri,
        licenseGrantCid: savedLicense.cid,
      });
      setPublishDone({
        snap,
        listingPrefillPath: `/merchant/listings?${params.toString()}`,
      });
      toast.success("Published to your PDS. Add a listing when you are ready.");
      setSessionId(null);
      setRows([]);
      setFiles([]);
      setArtworkFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }, [
    sessionId,
    savedLicense,
    rows,
    collectionMode,
    collectionTitle,
    price,
    titles,
    itemClass,
    artworkObjectId,
  ]);

  if (!session || !agent) return null;

  return (
    <div className="w-full min-w-0 max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">Upload tracks</h1>
      <p className="text-sm text-muted-foreground">
        Files go to R2; nothing is written to your PDS until you publish.
      </p>

      <div className="space-y-3">
        {!sessionId ? (
          <Button type="button" disabled={busy} onClick={() => void startSession()}>
            Start upload session
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Session: {sessionId}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Audio files (one or more)</Label>
        <Input
          type="file"
          multiple
          accept="audio/*,.flac,.wav,.mp3"
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            setFiles(list);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>Artwork (optional)</Label>
        <Input
          type="file"
          accept="image/*"
          onChange={(e) => setArtworkFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <Button
        type="button"
        disabled={busy || !sessionId || files.length === 0}
        onClick={() => void registerAndUpload()}
      >
        Register &amp; upload
      </Button>

      {rows.length > 0 ? (
        <ul className="rounded-md border border-border divide-y text-sm">
          {rows.map((r, i) => (
            <li key={r.objectId} className="px-3 py-2 space-y-1">
              <div className="flex justify-between gap-2">
                <span className="truncate">{r.file.name}</span>
                <span className="text-muted-foreground shrink-0">{r.status}</span>
              </div>
              {r.error ? (
                <p className="text-destructive text-xs">{r.error}</p>
              ) : null}
              <Input
                placeholder="Title"
                value={titles[i] ?? ""}
                onChange={(e) =>
                  setTitles((t) => ({ ...t, [i]: e.target.value }))
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        <Label>Item class (all tracks)</Label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={itemClass}
          onChange={(e) =>
            setItemClass(e.target.value as DigitalItem["itemClass"])
          }
        >
          {ITEM_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {rows.length > 1 ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={collectionMode}
            onChange={(e) => setCollectionMode(e.target.checked)}
          />
          Release as collection (album)
        </label>
      ) : null}

      {collectionMode ? (
        <div className="space-y-2">
          <Label>Collection title</Label>
          <Input
            value={collectionTitle}
            onChange={(e) => setCollectionTitle(e.target.value)}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>License (from your PDS)</Label>
        {licenseRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Save templates on{" "}
            <Link to="/merchant/license" className="underline">
              License
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-2 max-h-48 overflow-y-auto">
            {licenseRows.map((row) => {
              const picked =
                savedLicense?.uri === row.uri && savedLicense?.cid === row.cid;
              return (
                <button
                  key={row.uri}
                  type="button"
                  onClick={() =>
                    setSavedLicense({ uri: row.uri, cid: row.cid })
                  }
                  className={cn(
                    "rounded-lg border p-2 text-left text-sm",
                    picked && "ring-2 ring-ring",
                  )}
                >
                  {row.terms.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Suggested listing price (USD)</Label>
        <Input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Used only to pre-fill the listing form. Publishing does not create a listing.
        </p>
      </div>

      <Button
        type="button"
        disabled={busy || !sessionId || rows.some((r) => r.status !== "done")}
        onClick={() => void publish()}
      >
        Publish to PDS
      </Button>

      {publishDone ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm">
          <p className="font-medium">Catalog saved</p>
          <p className="text-muted-foreground">
            Your item is in your repo. Create a storefront listing in one step (you can
            edit price and status before saving).
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to={publishDone.listingPrefillPath}
              className={cn(buttonVariants())}
            >
              Pre-fill new listing
            </Link>
            <Link
              to={`/item/${encodeURIComponent(publishDone.snap.primaryItemUri)}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Preview item page
            </Link>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPublishDone(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
