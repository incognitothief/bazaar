import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AudioFileDropzone } from "@/components/shared/AudioFileDropzone";
import {
  BatchAudioFileDropzone,
  type BatchAudioEntry,
} from "@/components/shared/BatchAudioFileDropzone";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
import { CompletenessIndicator } from "@/components/merchant/CompletenessIndicator";
import { TrackListBuilder, type TrackSlot } from "@/components/merchant/TrackListBuilder";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { scoreCompleteness } from "@/hooks/useCompletenessScore";
import type { ParsedAudioMeta } from "@/lib/audio/parse";
import {
  createCollection,
  createDigitalItem,
  createLicenseTerms,
  createListing,
  findLicenseByTemplateKey,
  LICENSE_TEMPLATES,
  type LicenseTemplateKey,
} from "@/lib/atproto/records";
import { sha256HexOfFile } from "@/lib/crypto/sha256File";
import { uploadBlob } from "@/lib/atproto/upload";
import type { CompletenessSubject } from "@/hooks/useCompletenessScore";
import type { BazaarItemType } from "@/types/lexicons";

const ITEM_CLASSES = [
  "track",
  "album",
  "samplePack",
  "preset",
  "stems",
  "video",
  "ebook",
  "other",
] as const;

export function UploadDigitalPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  const defaultClass = search.get("class") === "album" ? "album" : "track";

  const [step, setStep] = useState(1);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [parsedMeta, setParsedMeta] = useState<ParsedAudioMeta | null>(null);
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [itemClass, setItemClass] =
    useState<(typeof ITEM_CLASSES)[number]>(defaultClass);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [audioErr, setAudioErr] = useState("");
  const [artErr, setArtErr] = useState("");
  const [albumTracks, setAlbumTracks] = useState<TrackSlot[]>([]);
  const [batchStaged, setBatchStaged] = useState<BatchAudioEntry[]>([]);

  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("");
  const [releaseDate, setReleaseDate] = useState("");

  const [licenseMode, setLicenseMode] = useState<"template" | "custom">(
    "template",
  );
  const [licenseTemplateKey, setLicenseTemplateKey] =
    useState<LicenseTemplateKey | null>("personalOnly");

  const [priceAmount, setPriceAmount] = useState("9.99");
  const [listingStatus, setListingStatus] = useState<
    "active" | "paused" | "scheduled"
  >("active");
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<string | null>(null);

  const completenessPreview = useMemo(() => {
    if (itemClass === "album") {
      const base: CompletenessSubject = {
        $type: "diamonds.whereditgo.bazaar.catalog.collection",
        title,
        artistDid: session?.did ?? "",
        releaseDate: releaseDate || new Date().toISOString(),
        items: albumTracks.map((t) => ({
          uri: t.uri,
          cid: t.cid,
          role: "track" as const,
          essential: true,
          trackNumber: t.trackNumber,
        })),
        description: description || undefined,
        genre: genre
          ? genre.split(",").map((g) => g.trim()).filter(Boolean)
          : undefined,
        artworkCid: artworkFile ? "pending" : undefined,
      };
      return scoreCompleteness(base);
    }
    const base: CompletenessSubject = {
      title,
      artistDid: session?.did ?? "",
      itemClass,
      formats: parsedMeta ? [parsedMeta.format] : [],
      hasAudioFile: !!audioFile,
      fileChecksum: audioFile ? "pending" : undefined,
      fileCid: audioFile ? "pending" : undefined,
      description: description || undefined,
      genre: genre
        ? genre.split(",").map((g) => g.trim()).filter(Boolean)
        : undefined,
      releaseDate: releaseDate || undefined,
      artworkCid: artworkFile ? "pending" : undefined,
    };
    return scoreCompleteness(base);
  }, [
    title,
    session?.did,
    itemClass,
    parsedMeta,
    audioFile,
    description,
    genre,
    releaseDate,
    artworkFile,
    albumTracks,
  ]);

  const appendBatch = useCallback((entries: BatchAudioEntry[]) => {
    setBatchStaged((prev) => {
      const seen = new Set(prev.map((e) => `${e.file.name}-${e.file.size}`));
      const add = entries.filter((e) => {
        const k = `${e.file.name}-${e.file.size}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return [...prev, ...add];
    });
  }, []);

  if (!session || !agent) return null;

  const step1Valid =
    !!title.trim() &&
    !!artistName.trim() &&
    (itemClass === "album"
      ? albumTracks.length > 0 || batchStaged.length > 0
      : !!audioFile && !!parsedMeta);

  function buildLicenseTermsPayload() {
    if (licenseMode !== "template" || !licenseTemplateKey) return null;
    const t = LICENSE_TEMPLATES[licenseTemplateKey];
    return {
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
    };
  }

  async function onPublish() {
    if (!agent || !session) return;
    if (
      itemClass === "album" &&
      albumTracks.length === 0 &&
      batchStaged.length > 0
    ) {
      toast.error("Batch collection publish is not available yet", {
        description:
          "Staged files are ready for when catalog APIs support batch import. Add existing track records, or publish after backend support lands.",
      });
      return;
    }
    const licensePayload = buildLicenseTermsPayload();
    if (!licensePayload) {
      toast.error("Select a license template");
      return;
    }
    const cents = Math.round(parseFloat(priceAmount || "0") * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast.error("Invalid price");
      return;
    }
    setSubmitting(true);
    try {
      setSubmitStep("Uploading artwork…");
      let artworkCid: string | undefined;
      if (artworkFile) {
        artworkCid = await uploadBlob(agent, artworkFile);
      }
      setSubmitStep("Uploading audio…");
      let licenseUri: string;
      let licenseGrantCid: string;
      const existing = await findLicenseByTemplateKey(
        agent,
        session.did,
        licenseTemplateKey!,
      );
      if (existing) {
        licenseUri = existing.uri;
        licenseGrantCid = existing.cid;
      } else {
        const lic = await createLicenseTerms(agent, licensePayload);
        licenseUri = lic.uri;
        licenseGrantCid = lic.cid;
      }
      setSubmitStep("Creating catalog record…");
      let itemUri: string;
      let itemCid: string;
      let itemType: BazaarItemType;
      if (itemClass === "album") {
        const rel = releaseDate || new Date().toISOString();
        const col = await createCollection(agent, {
          title,
          artistDid: session.did,
          releaseDate: rel,
          items: albumTracks.map((t) => ({
            uri: t.uri,
            cid: t.cid,
            role: "track" as const,
            essential: true,
            trackNumber: t.trackNumber,
          })),
          defaultLicenseUri: licenseUri,
          artworkCid,
          description: description || undefined,
          genre: genre
            ? genre.split(",").map((g) => g.trim()).filter(Boolean)
            : undefined,
        });
        itemUri = col.uri;
        itemCid = col.cid;
        itemType = "diamonds.whereditgo.bazaar.catalog.collection";
      } else {
        if (!audioFile || !parsedMeta) throw new Error("Missing audio");
        const fileCid = await uploadBlob(agent, audioFile);
        const fileChecksum = await sha256HexOfFile(audioFile);
        const fileFormat =
          audioFile.type ||
          (parsedMeta.format === "flac"
            ? "audio/flac"
            : parsedMeta.format === "mp3"
              ? "audio/mpeg"
              : `audio/${parsedMeta.format}`);
        const dig = await createDigitalItem(agent, {
          title,
          artistDid: session.did,
          itemClass,
          formats: [parsedMeta.format],
          fileChecksum,
          fileCid,
          fileFormat,
          durationMs: parsedMeta.durationMs,
          releaseDate: releaseDate || undefined,
          artworkCid,
          description: description || undefined,
          genre: genre
            ? genre.split(",").map((g) => g.trim()).filter(Boolean)
            : undefined,
          isrc: parsedMeta.isrc,
          defaultLicenseUri: licenseUri,
        });
        itemUri = dig.uri;
        itemCid = dig.cid;
        itemType = "diamonds.whereditgo.bazaar.catalog.item.digital";
      }
      setSubmitStep("Creating listing…");
      await createListing(agent, {
        item: {
          uri: itemUri,
          cid: itemCid,
          itemType: itemType as BazaarItemType,
        },
        licenseUri,
        licenseGrantCid,
        price: { amount: cents, currency: "USD" },
        status:
          listingStatus === "paused"
            ? "paused"
            : listingStatus === "scheduled"
              ? "scheduled"
              : "active",
      });
      toast.success("Your track is live.");
      navigate("/merchant/dashboard");
    } catch (e) {
      toast.error("Failed to publish", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
      setSubmitStep(null);
    }
  }

  return (
    <div className="w-full min-w-0 max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">Upload digital release</h1>
      <div className="flex gap-2 text-sm text-muted-foreground">
        {[1, 2, 3, 4].map((s) => (
          <span
            key={s}
            className={s === step ? "text-foreground font-medium" : ""}
          >
            Step {s}
          </span>
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-6">
          {itemClass === "album" ? (
            <p className="text-sm text-muted-foreground">
              Albums use your existing track records. Add them below (audio file
              optional for packaging-only releases).
            </p>
          ) : (
            <AudioFileDropzone
              onFile={(f, m) => {
                setAudioFile(f);
                setParsedMeta(m);
                if (!title && m.title) setTitle(m.title);
                if (!artistName && m.artist) setArtistName(m.artist);
              }}
              onError={setAudioErr}
            />
          )}
          {audioErr ? (
            <p className="text-sm text-destructive">{audioErr}</p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="artist">Artist name</Label>
            <Input
              id="artist"
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              placeholder={session.handle || "Artist"}
            />
          </div>
          <div className="space-y-2">
            <Label>Item class</Label>
            <Select
              value={itemClass}
              onValueChange={(v) => {
                const next = v as (typeof ITEM_CLASSES)[number];
                setItemClass(next);
                if (next !== "album") setBatchStaged([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {itemClass === "album" ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Batch audio (collections)</p>
                <BatchAudioFileDropzone
                  onBatch={appendBatch}
                  onError={(m) => toast.error(m)}
                />
                {batchStaged.length > 0 ? (
                  <ul className="rounded-md border border-border divide-y divide-border text-sm max-h-48 overflow-auto">
                    {batchStaged.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="truncate">
                          {e.meta.title || e.file.name}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setBatchStaged((prev) =>
                              prev.filter((x) => x.id !== e.id),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <TrackListBuilder
                artistDid={session.did}
                agent={agent}
                value={albumTracks}
                onChange={setAlbumTracks}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Artwork (optional)</Label>
            <ImageDropzone
              onFile={(f, url) => {
                setArtworkFile(f);
                setArtPreview(url);
              }}
              onError={setArtErr}
            />
            {artErr ? (
              <p className="text-sm text-destructive">{artErr}</p>
            ) : null}
            {!artworkFile ? (
              <p className="text-xs text-muted-foreground">
                Artwork increases conversion by ~40%.
              </p>
            ) : null}
            {artPreview ? (
              <p className="text-xs text-muted-foreground">Preview loaded.</p>
            ) : null}
          </div>
          <Button disabled={!step1Valid} onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          <CompletenessIndicator
            score={completenessPreview}
            onFieldClick={(id) => {
              const el = document.getElementById(`meta-${id}`);
              el?.scrollIntoView({ behavior: "smooth" });
            }}
          />
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="meta-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4096}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="genre">Genre (comma-separated)</Label>
            <Input
              id="meta-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rel">Release date</Label>
            <Input
              id="meta-releaseDate"
              type="date"
              value={releaseDate.slice(0, 10)}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="ghost" onClick={() => setStep(3)}>
              Skip for now — you can add this later
            </Button>
            <Button onClick={() => setStep(3)}>Continue</Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={licenseMode === "template" ? "default" : "outline"}
              size="sm"
              onClick={() => setLicenseMode("template")}
            >
              Templates
            </Button>
            <Button
              type="button"
              variant={licenseMode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => setLicenseMode("custom")}
            >
              Customize further
            </Button>
          </div>
          {licenseMode === "template" ? (
            <div className="grid gap-3">
              {(Object.keys(LICENSE_TEMPLATES) as LicenseTemplateKey[]).map(
                (k) => {
                  const t = LICENSE_TEMPLATES[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLicenseTemplateKey(k)}
                      className={`rounded-lg border p-4 text-left ${
                        licenseTemplateKey === k ? "ring-2 ring-ring" : ""
                      }`}
                    >
                      <p className="font-medium">{t.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t.summary}
                      </p>
                    </button>
                  );
                },
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Full license form is available on the License templates page;
              template selection is required here — switch back to templates or
              pick one above.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              disabled={!licenseTemplateKey}
              onClick={() => setStep(4)}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="price">Price (USD)</Label>
            <Input
              id="price"
              inputMode="decimal"
              value={priceAmount}
              onChange={(e) => setPriceAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Listing status</Label>
            <Select
              value={listingStatus}
              onValueChange={(v) =>
                setListingStatus(v as typeof listingStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CompletenessIndicator score={completenessPreview} />
          <p className="text-xs text-muted-foreground">
            You can complete deferred metadata any time from the dashboard.
          </p>
          <div className="flex gap-2 items-center">
            <Button variant="outline" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button disabled={submitting} onClick={() => void onPublish()}>
              {submitting ? submitStep ?? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
