import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useBlocker } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BatchAudioFileDropzone,
  type BatchAudioEntry,
} from "@/components/shared/BatchAudioFileDropzone";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
import {
  createInventorySession,
  inventoryUserFacingError,
  publishInventorySession,
  registerInventoryObjects,
  saveInventoryDraft,
  uploadFileToInventoryObject,
} from "@/lib/api/inventoryApi";
import { Progress } from "@/components/ui/progress";
import {
  listCompositionRows,
  listLicenseTermsRows,
  type CompositionRow,
  type LicenseTermsRow,
} from "@/lib/atproto/records";
import { postIdentifierWid } from "@/lib/api/identifiersApi";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { cn } from "@/lib/utils";
import type {
  CollectionItemRole,
  Composition,
  DigitalItem,
} from "@/types/lexicons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COLLECTION_TYPES = [
  { value: "single", label: "Single" },
  { value: "ep", label: "EP" },
  { value: "album", label: "Album" },
  { value: "compilation", label: "Compilation" },
  { value: "other", label: "Other" },
] as const;

type CollectionTypeValue = (typeof COLLECTION_TYPES)[number]["value"];

const EXTRA_ITEM_CLASSES: Array<
  Exclude<
    DigitalItem["itemClass"],
    "track" | "album" | "samplePack" | "preset" | "stems"
  >
> = ["video", "document", "other"];

function defaultRoleForItemClass(
  ic: DigitalItem["itemClass"],
  file?: File,
): CollectionItemRole {
  if (file?.type.startsWith("image/")) return "artwork";
  if (ic === "video") return "video";
  if (ic === "document") return "document";
  return "other";
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function stripExtension(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base || fileName.trim() || "Untitled";
}

const INVENTORY_MULTIPART_MIN_BYTES = 8 * 1024 * 1024;

/** Pills for file/upload rows (tracks, extras, artwork) — shared look. */
function fileRowStatusBadge(
  variant: "pending" | "uploading" | "done" | "error" | "queued",
): { text: string; className: string } {
  switch (variant) {
    case "uploading":
      return {
        text: "Uploading",
        className: "border-amber-500/50 text-amber-700 dark:text-amber-400",
      };
    case "done":
      return {
        text: "Done",
        className:
          "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
      };
    case "error":
      return {
        text: "Failed",
        className: "border-destructive/50 text-destructive",
      };
    case "queued":
      return {
        text: "Queued",
        className: "border-sky-500/50 text-sky-700 dark:text-sky-400",
      };
    default:
      return {
        text: "Pending",
        className: "border-muted-foreground/40 text-muted-foreground",
      };
  }
}

/** Same rules as `ImageDropzone` (square release art). */
function validateSquareArtworkFile(
  file: File,
  onError: (msg: string) => void,
): Promise<boolean> {
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    onError("Image too large (max 10 MB)");
    return Promise.resolve(false);
  }
  if (!file.type.startsWith("image/")) {
    onError("Please use JPEG, PNG, or WebP.");
    return Promise.resolve(false);
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width < 600 || img.height < 600) {
        onError("Minimum dimensions 600×600 for square artwork.");
        resolve(false);
        return;
      }
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      onError("Could not read image.");
      resolve(false);
    };
    img.src = url;
  });
}

const WRITER_ROLE_NONE = "__none__" as const;

const WRITER_ROLE_OPTIONS = [
  { value: WRITER_ROLE_NONE, label: "Role (optional)" },
  { value: "composer", label: "Composer" },
  { value: "lyricist", label: "Lyricist" },
  { value: "composerLyricist", label: "Composer & lyricist" },
  { value: "arranger", label: "Arranger" },
  { value: "adapter", label: "Adapter" },
] as const;

type CoWriterForm = {
  id: string;
  name: string;
  ipi: string;
  did: string;
  share: string;
  role: string;
};

type PublisherForm = {
  id: string;
  name: string;
  ipi: string;
  did: string;
  pro: string;
  share: string;
};

type ProRegForm = {
  id: string;
  pro: string;
  registrationId: string;
  territory: string;
};

type TrackRightsState = {
  compositionPath: "new" | "existing";
  existingCompositionUri: string;
  existingCompositionCid: string;
  existingBazaarWid: {
    id: string;
    sig: string;
    generatedAt: string;
  } | null;
  linkedCompositionSnapshot: Composition | null;
  compositionTitle: string;
  masterOwnerDid: string;
  publishingOwnerDid: string;
  publishingOwnerIpi: string;
  iswc: string;
  copyrightYear: string;
  copyrightRegistrationId: string;
  writers: CoWriterForm[];
  publishers: PublisherForm[];
  proRegistrations: ProRegForm[];
};

function emptyTrackRights(did: string): TrackRightsState {
  return {
    compositionPath: "new",
    existingCompositionUri: "",
    existingCompositionCid: "",
    existingBazaarWid: null,
    linkedCompositionSnapshot: null,
    compositionTitle: "",
    masterOwnerDid: did,
    publishingOwnerDid: did,
    publishingOwnerIpi: "",
    iswc: "",
    copyrightYear: "",
    copyrightRegistrationId: "",
    writers: [],
    publishers: [],
    proRegistrations: [],
  };
}

function parseBazaarIdentifierClient(v: unknown): {
  id: string;
  sig: string;
  generatedAt: string;
} | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id === "string" &&
    typeof o.sig === "string" &&
    typeof o.generatedAt === "string"
  ) {
    return { id: o.id, sig: o.sig, generatedAt: o.generatedAt };
  }
  return null;
}

function buildTrackRightsDraftForPublish(
  r: TrackRightsState,
  sessionDid: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    compositionPath: r.compositionPath,
    masterOwnerDid: r.masterOwnerDid.trim() || sessionDid,
    publishingOwnerDid: r.publishingOwnerDid.trim() || sessionDid,
  };
  if (r.publishingOwnerIpi.trim()) {
    out.publishingOwnerIpi = r.publishingOwnerIpi.trim();
  }

  if (r.compositionPath === "existing") {
    if (r.existingCompositionUri.trim()) {
      out.existingCompositionUri = r.existingCompositionUri.trim();
    }
    if (r.existingCompositionCid.trim()) {
      out.existingCompositionCid = r.existingCompositionCid.trim();
    }
    if (r.existingBazaarWid) out.existingBazaarWid = r.existingBazaarWid;
    if (r.iswc.trim()) out.iswc = r.iswc.trim();
    return out;
  }

  if (r.compositionTitle.trim()) {
    out.compositionTitle = r.compositionTitle.trim();
  }
  if (r.iswc.trim()) out.iswc = r.iswc.trim();
  if (r.copyrightYear.trim()) {
    const y = parseInt(r.copyrightYear, 10);
    if (Number.isFinite(y)) out.copyrightYear = y;
  }
  if (r.copyrightRegistrationId.trim()) {
    out.copyrightRegistrationId = r.copyrightRegistrationId.trim();
  }

  const writers = r.writers
    .filter((w) => w.name.trim())
    .map((w) => {
      const row: Record<string, unknown> = { name: w.name.trim() };
      if (w.ipi.trim()) row.ipi = w.ipi.trim();
      if (w.did.trim()) row.did = w.did.trim();
      if (w.share.trim()) {
        const n = parseFloat(w.share);
        if (Number.isFinite(n)) row.share = n;
      }
      const role = w.role.trim();
      if (role && role !== WRITER_ROLE_NONE) row.role = role;
      return row;
    });
  if (writers.length) out.writers = writers;

  const publishers = r.publishers
    .filter((p) => p.name.trim())
    .map((p) => {
      const row: Record<string, unknown> = { name: p.name.trim() };
      if (p.ipi.trim()) row.ipi = p.ipi.trim();
      if (p.did.trim()) row.did = p.did.trim();
      if (p.pro.trim()) row.pro = p.pro.trim();
      if (p.share.trim()) {
        const n = parseFloat(p.share);
        if (Number.isFinite(n)) row.share = n;
      }
      return row;
    });
  if (publishers.length) out.publishers = publishers;

  const proRegistrations = r.proRegistrations
    .filter((x) => x.pro.trim())
    .map((x) => {
      const row: Record<string, unknown> = { pro: x.pro.trim() };
      if (x.registrationId.trim()) row.registrationId = x.registrationId.trim();
      if (x.territory.trim()) row.territory = x.territory.trim();
      return row;
    });
  if (proRegistrations.length) out.proRegistrations = proRegistrations;

  return out;
}

type RegRow = {
  objectId: string;
  uploadKind: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  durationMs?: number;
};

type AudioRowState = RegRow & {
  title: string;
  isrc: string;
  discNumber: string;
  showDisc: boolean;
  description: string;
  rights: TrackRightsState;
  allowIndividualPurchase: boolean;
};

type ExtraRowState = RegRow & {
  title: string;
  itemClass: (typeof EXTRA_ITEM_CLASSES)[number];
  role: CollectionItemRole;
  allowIndividualPurchase: boolean;
  description: string;
};

type StagedExtra = { id: string; file: File };

function inferExtraItemClass(file: File): (typeof EXTRA_ITEM_CLASSES)[number] {
  const t = file.type;
  if (t.startsWith("video/")) return "video";
  if (
    t === "application/pdf" ||
    t.startsWith("text/") ||
    t === "application/msword"
  )
    return "document";
  return "other";
}

/** Optional-metadata advisory score (0–100). Does not gate publish. */
function computeRecommendedScore(input: {
  hasArtwork: boolean;
  genreTags: string[];
  upc: string;
  releaseDescription: string;
  audioRows: AudioRowState[];
}): number {
  let s = 0;
  if (input.hasArtwork) s += 18;
  if (input.genreTags.length > 0) s += 15;
  if (input.upc.trim()) s += 10;
  if (input.releaseDescription.trim()) s += 15;
  const n = input.audioRows.length || 1;
  const isrcAvg = input.audioRows.filter((r) => r.isrc.trim()).length / n;
  s += Math.round(20 * isrcAvg);
  const descAvg =
    input.audioRows.filter((r) => r.description.trim()).length / n;
  s += Math.round(22 * descAvg);
  return Math.min(100, s);
}

function BazaarWidLivePreview({
  artistDid,
  compositionTitle,
  writers,
}: {
  artistDid: string;
  compositionTitle: string;
  writers: CoWriterForm[];
}) {
  const [label, setLabel] = useState<string | null>(null);
  const writersKey = useMemo(
    () =>
      JSON.stringify(
        writers.map((w) => ({
          n: w.name.trim(),
          i: w.ipi.trim(),
          d: w.did.trim(),
        })),
      ),
    [writers],
  );
  useEffect(() => {
    const t = setTimeout(() => {
      const raw = compositionTitle.trim() || "Untitled work";
      void postIdentifierWid({
        artistDid,
        compositionTitle: raw,
        writers: writers.map((w) => ({
          name: w.name.trim() || undefined,
          ipi: w.ipi.trim() || undefined,
          did: w.did.trim() || undefined,
        })),
        createdAt: new Date().toISOString(),
      })
        .then((j) => setLabel(j.bazaarWid.id))
        .catch(() => setLabel(null));
    }, 500);
    return () => clearTimeout(t);
  }, [artistDid, compositionTitle, writersKey]);
  return (
    <p className="text-xs font-mono bg-muted/60 rounded px-2 py-1.5 break-all min-h-[2rem]">
      {label ?? "…"}
    </p>
  );
}

export function UploadTracksPage() {
  const navigate = useNavigate();
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  const [step, setStep] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkObjectId, setArtworkObjectId] = useState<string | null>(null);
  /** Set when an inventory object is registered for the current cover file (batch or early upload). */
  const [artworkUploadKind, setArtworkUploadKind] = useState<string | null>(
    null,
  );
  /** True once bytes for `artworkObjectId` are on R2 (early upload or batch tail). */
  const [artworkInventoryUploadDone, setArtworkInventoryUploadDone] =
    useState(false);

  const [releaseTitle, setReleaseTitle] = useState("");
  const [collectionType, setCollectionType] =
    useState<CollectionTypeValue>("single");
  const [releaseDate, setReleaseDate] = useState("");
  const [genreInput, setGenreInput] = useState("");
  const [releaseDescription, setReleaseDescription] = useState("");
  const [upc, setUpc] = useState("");

  const [stagedAudio, setStagedAudio] = useState<BatchAudioEntry[]>([]);
  const [stagedExtra, setStagedExtra] = useState<StagedExtra[]>([]);
  const [audioRows, setAudioRows] = useState<AudioRowState[]>([]);
  const [extraRows, setExtraRows] = useState<ExtraRowState[]>([]);
  const [expandedAudioId, setExpandedAudioId] = useState<string | null>(null);
  const [compositionPickerObjectId, setCompositionPickerObjectId] = useState<
    string | null
  >(null);
  const [compositionRows, setCompositionRows] = useState<CompositionRow[]>([]);
  const [compositionSearch, setCompositionSearch] = useState("");

  const [busy, setBusy] = useState(false);
  const [artworkUploadBusy, setArtworkUploadBusy] = useState(false);
  const [uploadBatchProgress, setUploadBatchProgress] = useState<{
    loaded: number;
    total: number;
    label: string;
    itemIndex?: number;
    itemTotal?: number;
  } | null>(null);
  const step2ArtworkReplaceInputId = useId();
  const step2ArtworkEmptyInputId = useId();
  const step2ArtworkReplaceInputRef = useRef<HTMLInputElement>(null);

  const [savedLicense, setSavedLicense] = useState<{
    uri: string;
    cid: string;
  } | null>(null);
  const [licenseRows, setLicenseRows] = useState<LicenseTermsRow[]>([]);
  const [licenseRowsLoading, setLicenseRowsLoading] = useState(false);

  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const sessionInflightRef = useRef<Promise<string> | null>(null);
  const skipLeaveGuardRef = useRef(false);
  const audioRowsRef = useRef<AudioRowState[]>([]);
  const extraRowsRef = useRef<ExtraRowState[]>([]);

  const artworkPreviewUrl = useMemo(
    () => (artworkFile ? URL.createObjectURL(artworkFile) : null),
    [artworkFile],
  );

  useEffect(() => {
    return () => {
      if (artworkPreviewUrl) URL.revokeObjectURL(artworkPreviewUrl);
    };
  }, [artworkPreviewUrl]);

  const hasInProgressWork =
    sessionId != null ||
    audioRows.length > 0 ||
    extraRows.length > 0 ||
    stagedAudio.length > 0 ||
    stagedExtra.length > 0 ||
    !!artworkObjectId ||
    !!artworkFile;

  const leaveBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !skipLeaveGuardRef.current &&
      hasInProgressWork &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (leaveBlocker.state !== "blocked") return;
    const leave = window.confirm(
      "You have an upload session in progress. Leave this page? Changes on this screen may be lost.",
    );
    if (leave) {
      skipLeaveGuardRef.current = true;
      leaveBlocker.proceed();
    } else {
      leaveBlocker.reset();
    }
  }, [leaveBlocker, leaveBlocker.state]);

  useEffect(() => {
    if (!hasInProgressWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasInProgressWork]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    audioRowsRef.current = audioRows;
  }, [audioRows]);

  useEffect(() => {
    extraRowsRef.current = extraRows;
  }, [extraRows]);

  useEffect(() => {
    if (!compositionPickerObjectId || !agent || !session) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCompositionRows(session.did);
        if (!cancelled) setCompositionRows(rows);
      } catch {
        if (!cancelled) setCompositionRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compositionPickerObjectId, agent, session]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!sessionInflightRef.current) {
      sessionInflightRef.current = createInventorySession("digital")
        .then(({ sessionId: sid }) => {
          sessionIdRef.current = sid;
          setSessionId(sid);
          return sid;
        })
        .finally(() => {
          sessionInflightRef.current = null;
        });
    }
    return sessionInflightRef.current;
  }, []);

  const uploadArtworkFile = useCallback(
    async (file: File): Promise<string> => {
      if (!session?.did) throw new Error("Not signed in");
      const sid = await ensureSession();
      const reg = await registerInventoryObjects(sid, [
        {
          slotId: crypto.randomUUID(),
          fileName: file.name,
          contentType: file.type || undefined,
          byteSize: file.size,
          role: "artwork",
        },
      ]);
      const art = reg.objects[0];
      if (!art) throw new Error("Artwork registration failed");
      await uploadFileToInventoryObject(art.objectId, file, art.uploadKind);
      setArtworkObjectId(art.objectId);
      setArtworkUploadKind(art.uploadKind);
      setArtworkInventoryUploadDone(true);
      setArtworkFile(file);
      return art.objectId;
    },
    [session?.did, ensureSession],
  );

  const uploadPendingReleaseArtwork = useCallback(async (): Promise<
    string | undefined
  > => {
    if (artworkObjectId) return artworkObjectId;
    if (!artworkFile) return undefined;
    return uploadArtworkFile(artworkFile);
  }, [artworkObjectId, artworkFile, uploadArtworkFile]);

  const onReleaseArtworkChosen = useCallback(
    (f: File) => {
      setArtworkFile(f);
      setArtworkObjectId(null);
      setArtworkUploadKind(null);
      setArtworkInventoryUploadDone(false);
      if (audioRows.length > 0) {
        setArtworkUploadBusy(true);
        void (async () => {
          try {
            await uploadArtworkFile(f);
            toast.success("Cover art saved to your upload session");
          } catch (e) {
            toast.error(inventoryUserFacingError(e));
          } finally {
            setArtworkUploadBusy(false);
          }
        })();
      }
    },
    [audioRows.length, uploadArtworkFile],
  );

  const appendStagedAudio = useCallback(
    (entries: BatchAudioEntry[]) => {
      if (entries.length === 0) return;
      void (async () => {
        try {
          await ensureSession();
        } catch (e) {
          toast.error(inventoryUserFacingError(e));
          return;
        }
        setStagedAudio((prev) => {
          const seen = new Set(
            prev.map((e) => `${e.file.name}-${e.file.size}`),
          );
          const add = entries.filter((e) => {
            const k = `${e.file.name}-${e.file.size}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          return [...prev, ...add];
        });
      })();
    },
    [ensureSession],
  );

  const genreTags = genreInput
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

  const step1Valid = !!releaseTitle.trim() && !!releaseDate.trim();

  const uploadsComplete =
    audioRows.length > 0 &&
    audioRows.every((r) => r.status === "done") &&
    extraRows.every((r) => r.status === "done");

  const needsResumeUpload =
    (audioRows.length > 0 || extraRows.length > 0) &&
    (audioRows.some((r) => r.status !== "done") ||
      extraRows.some((r) => r.status !== "done") ||
      !!(artworkFile && artworkObjectId && !artworkInventoryUploadDone));

  const tracksMetaValid =
    uploadsComplete &&
    audioRows.every((r) => r.title.trim()) &&
    extraRows.every((r) => r.title.trim());

  const step3LicenseOk = !!savedLicense;

  const requiredGateOk =
    step1Valid &&
    audioRows.length > 0 &&
    audioRows.every((r) => r.title.trim()) &&
    step3LicenseOk &&
    reviewAcknowledged;

  const recommendedScore = computeRecommendedScore({
    hasArtwork: !!artworkObjectId || !!artworkFile,
    genreTags,
    upc,
    releaseDescription,
    audioRows,
  });

  const canPublish = requiredGateOk && uploadsComplete && !busy;

  const goToStep = useCallback(
    (n: number) => {
      if (n === step) return;
      if (n < step) {
        setStep(n);
        return;
      }
      if (n === 2 && !step1Valid) {
        toast.error("Add a release title and date first.");
        return;
      }
      if (n === 3 && (!step1Valid || !tracksMetaValid)) {
        toast.error("Upload audio files and complete track metadata first.");
        return;
      }
      if (n === 4 && (!step1Valid || !tracksMetaValid || !step3LicenseOk)) {
        toast.error("Choose a license before opening review.");
        return;
      }
      setStep(n);
    },
    [step, step1Valid, tracksMetaValid, step3LicenseOk],
  );

  useEffect(() => {
    if (step !== 3 || !agent || !session?.did) return;
    let cancelled = false;
    setLicenseRowsLoading(true);
    void listLicenseTermsRows(session.did)
      .then((rows) => {
        if (!cancelled) setLicenseRows(rows);
      })
      .catch(() => {
        if (!cancelled) setLicenseRows([]);
      })
      .finally(() => {
        if (!cancelled) setLicenseRowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, agent, session?.did]);

  const moveAudio = (index: number, dir: -1 | 1) => {
    setAudioRows((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  };

  const removeAudioRow = useCallback((objectId: string) => {
    if (
      !window.confirm(
        "Remove this track from the draft? It will not be included when you publish.",
      )
    ) {
      return;
    }
    setAudioRows((prev) => prev.filter((r) => r.objectId !== objectId));
    setExpandedAudioId((id) => (id === objectId ? null : id));
  }, []);

  const removeExtraRow = useCallback((objectId: string) => {
    if (
      !window.confirm(
        "Remove this file from the draft? It will not be included when you publish.",
      )
    ) {
      return;
    }
    setExtraRows((prev) => prev.filter((r) => r.objectId !== objectId));
  }, []);

  const runInventoryUploads = useCallback(
    async (opts: {
      totalBytes: number;
      nextAudio: AudioRowState[];
      nextExtra: ExtraRowState[];
      artwork: {
        objectId: string;
        uploadKind: string;
        file: File;
      } | null;
    }) => {
      const { totalBytes, nextAudio, nextExtra, artwork } = opts;
      let doneBase = 0;
      for (const r of [...nextAudio, ...nextExtra]) {
        if (r.status === "done") doneBase += r.file.size;
      }

      const allMasters = [...nextAudio, ...nextExtra];
      const uploadItemsTotal = allMasters.length + (artwork ? 1 : 0);

      for (let i = 0; i < allMasters.length; i++) {
        const row = allMasters[i]!;
        if (row.status === "done") continue;

        const itemIndex = i + 1;
        if (i < nextAudio.length) {
          const idx = i;
          setAudioRows((prev) =>
            prev.map((r, j) =>
              j === idx
                ? { ...r, status: "uploading" as const, error: undefined }
                : r,
            ),
          );
          try {
            await uploadFileToInventoryObject(
              row.objectId,
              row.file,
              row.uploadKind,
              (pe) => {
                setUploadBatchProgress({
                  loaded: doneBase + pe.loaded,
                  total: Math.max(1, totalBytes),
                  label: row.file.name,
                  itemIndex,
                  itemTotal: uploadItemsTotal,
                });
              },
            );
            doneBase += row.file.size;
            setAudioRows((prev) =>
              prev.map((r, j) =>
                j === idx
                  ? { ...r, status: "done" as const, error: undefined }
                  : r,
              ),
            );
          } catch (err) {
            const msg = inventoryUserFacingError(err);
            setAudioRows((prev) =>
              prev.map((r, j) =>
                j === idx ? { ...r, status: "error" as const, error: msg } : r,
              ),
            );
            throw err;
          }
        } else {
          const idx = i - nextAudio.length;
          setExtraRows((prev) =>
            prev.map((r, j) =>
              j === idx
                ? { ...r, status: "uploading" as const, error: undefined }
                : r,
            ),
          );
          try {
            await uploadFileToInventoryObject(
              row.objectId,
              row.file,
              row.uploadKind,
              (pe) => {
                setUploadBatchProgress({
                  loaded: doneBase + pe.loaded,
                  total: Math.max(1, totalBytes),
                  label: row.file.name,
                  itemIndex,
                  itemTotal: uploadItemsTotal,
                });
              },
            );
            doneBase += row.file.size;
            setExtraRows((prev) =>
              prev.map((r, j) =>
                j === idx
                  ? { ...r, status: "done" as const, error: undefined }
                  : r,
              ),
            );
          } catch (err) {
            const msg = inventoryUserFacingError(err);
            setExtraRows((prev) =>
              prev.map((r, j) =>
                j === idx ? { ...r, status: "error" as const, error: msg } : r,
              ),
            );
            throw err;
          }
        }
      }

      if (artwork) {
        const artItemIndex = allMasters.length + 1;
        await uploadFileToInventoryObject(
          artwork.objectId,
          artwork.file,
          artwork.uploadKind,
          (pe) => {
            setUploadBatchProgress({
              loaded: doneBase + pe.loaded,
              total: Math.max(1, totalBytes),
              label: artwork.file.name,
              itemIndex: artItemIndex,
              itemTotal: uploadItemsTotal,
            });
          },
        );
        setArtworkInventoryUploadDone(true);
      }
    },
    [],
  );

  const registerAndUploadAll = useCallback(async () => {
    if (!session?.did) {
      toast.error("Sign in to upload");
      return;
    }
    const merchantDid = session.did;
    if (stagedAudio.length === 0) {
      toast.error("Add at least one audio track");
      return;
    }
    const artworkBytes = artworkFile && !artworkObjectId ? artworkFile.size : 0;
    const totalBytes =
      stagedAudio.reduce((s, e) => s + e.file.size, 0) +
      stagedExtra.reduce((s, e) => s + e.file.size, 0) +
      artworkBytes;
    setBusy(true);
    setUploadBatchProgress({
      loaded: 0,
      total: Math.max(1, totalBytes),
      label: "Preparing upload…",
    });
    try {
      setUploadBatchProgress({
        loaded: 0,
        total: Math.max(1, totalBytes),
        label: "Starting session…",
      });
      const sid = await ensureSession();
      const audioFiles = stagedAudio.map((e) => e.file);
      const extraFiles = stagedExtra.map((s) => s.file);
      const objects: Array<{
        slotId: string;
        fileName: string;
        contentType?: string;
        byteSize: number;
        role: "master" | "artwork";
      }> = [...audioFiles, ...extraFiles].map((f) => ({
        slotId: crypto.randomUUID(),
        fileName: f.name,
        contentType: f.type || undefined,
        byteSize: f.size,
        role: "master" as const,
      }));
      if (artworkFile && !artworkObjectId) {
        objects.push({
          slotId: crypto.randomUUID(),
          fileName: artworkFile.name,
          contentType: artworkFile.type || undefined,
          byteSize: artworkFile.size,
          role: "artwork",
        });
      }
      setUploadBatchProgress({
        loaded: 0,
        total: Math.max(1, totalBytes),
        label: "Registering files…",
      });
      const reg = await registerInventoryObjects(sid, objects);
      const nAudio = audioFiles.length;
      const nExtra = extraFiles.length;
      const masterRegs = reg.objects.slice(0, nAudio + nExtra);
      const artReg =
        artworkFile && !artworkObjectId && reg.objects.length > nAudio + nExtra
          ? reg.objects[nAudio + nExtra]
          : null;
      setArtworkObjectId((prev) => artReg?.objectId ?? prev);
      if (artReg) {
        setArtworkUploadKind(artReg.uploadKind);
        setArtworkInventoryUploadDone(false);
      }

      const nextAudio: AudioRowState[] = audioFiles.map((file, i) => {
        const meta = stagedAudio[i]?.meta;
        const mr = masterRegs[i]!;
        return {
          objectId: mr.objectId,
          uploadKind: mr.uploadKind,
          file,
          status: "pending" as const,
          durationMs: meta?.durationMs,
          title: meta?.title?.trim() || stripExtension(file.name),
          isrc: meta?.isrc?.trim() ?? "",
          discNumber: "",
          showDisc: false,
          description: "",
          rights: emptyTrackRights(merchantDid),
          allowIndividualPurchase: false,
        };
      });
      const nextExtra: ExtraRowState[] = extraFiles.map((file, i) => {
        const mr = masterRegs[nAudio + i]!;
        const ic = inferExtraItemClass(file);
        return {
          objectId: mr.objectId,
          uploadKind: mr.uploadKind,
          file,
          status: "pending" as const,
          title: stripExtension(file.name),
          itemClass: ic,
          role: defaultRoleForItemClass(ic, file),
          allowIndividualPurchase: false,
          description: "",
        };
      });
      setAudioRows(nextAudio);
      setExtraRows(nextExtra);
      setStagedAudio([]);
      setStagedExtra([]);

      const artworkTarget =
        artworkFile && artReg
          ? {
              objectId: artReg.objectId,
              uploadKind: artReg.uploadKind,
              file: artworkFile,
            }
          : artworkFile &&
              artworkObjectId &&
              !artworkInventoryUploadDone
            ? {
                objectId: artworkObjectId,
                uploadKind:
                  artworkUploadKind ??
                  (artworkFile.size >= INVENTORY_MULTIPART_MIN_BYTES
                    ? "multipart"
                    : "single_put"),
                file: artworkFile,
              }
            : null;

      await runInventoryUploads({
        totalBytes,
        nextAudio,
        nextExtra,
        artwork: artworkTarget,
      });

      toast.success("Files uploaded — continue to license.");
    } catch (e) {
      toast.error(inventoryUserFacingError(e));
    } finally {
      setUploadBatchProgress(null);
      setBusy(false);
    }
  }, [
    ensureSession,
    runInventoryUploads,
    stagedAudio,
    stagedExtra,
    artworkFile,
    artworkObjectId,
    artworkUploadKind,
    artworkInventoryUploadDone,
    session,
  ]);

  const resumeInventoryUploads = useCallback(async () => {
    if (!session?.did) {
      toast.error("Sign in to upload");
      return;
    }
    const snapA = audioRowsRef.current;
    const snapE = extraRowsRef.current;
    if (snapA.length === 0 && snapE.length === 0) return;

    let totalNeed = 0;
    for (const r of [...snapA, ...snapE]) {
      if (r.status !== "done") totalNeed += r.file.size;
    }
    const artNeed =
      artworkFile && artworkObjectId && !artworkInventoryUploadDone
        ? artworkFile.size
        : 0;
    const totalBytes = Math.max(1, totalNeed + artNeed);

    setBusy(true);
    setUploadBatchProgress({
      loaded: 0,
      total: totalBytes,
      label: "Resuming upload…",
    });
    try {
      await ensureSession();
      const artworkTarget =
        artworkFile &&
        artworkObjectId &&
        !artworkInventoryUploadDone
          ? {
              objectId: artworkObjectId,
              uploadKind:
                artworkUploadKind ??
                (artworkFile.size >= INVENTORY_MULTIPART_MIN_BYTES
                  ? "multipart"
                  : "single_put"),
              file: artworkFile,
            }
          : null;

      await runInventoryUploads({
        totalBytes,
        nextAudio: snapA,
        nextExtra: snapE,
        artwork: artworkTarget,
      });

      toast.success("Files uploaded — continue to license.");
    } catch (e) {
      toast.error(inventoryUserFacingError(e));
    } finally {
      setUploadBatchProgress(null);
      setBusy(false);
    }
  }, [
    session?.did,
    ensureSession,
    runInventoryUploads,
    artworkFile,
    artworkObjectId,
    artworkUploadKind,
    artworkInventoryUploadDone,
  ]);

  const retryOneAudioUpload = useCallback(async (objectId: string) => {
    const row = audioRowsRef.current.find((r) => r.objectId === objectId);
    if (!row || row.status !== "error") return;
    setBusy(true);
    const totalBytes = Math.max(1, row.file.size);
    setUploadBatchProgress({
      loaded: 0,
      total: totalBytes,
      label: row.file.name,
    });
    try {
      setAudioRows((prev) =>
        prev.map((r) =>
          r.objectId === objectId
            ? { ...r, status: "uploading" as const, error: undefined }
            : r,
        ),
      );
      await uploadFileToInventoryObject(
        row.objectId,
        row.file,
        row.uploadKind,
        (pe) => {
          setUploadBatchProgress({
            loaded: pe.loaded,
            total: Math.max(1, totalBytes),
            label: row.file.name,
          });
        },
      );
      setAudioRows((prev) =>
        prev.map((r) =>
          r.objectId === objectId
            ? { ...r, status: "done" as const, error: undefined }
            : r,
        ),
      );
      toast.success(`Uploaded: ${row.file.name}`);
    } catch (e) {
      const msg = inventoryUserFacingError(e);
      setAudioRows((prev) =>
        prev.map((r) =>
          r.objectId === objectId
            ? { ...r, status: "error" as const, error: msg }
            : r,
        ),
      );
      toast.error(msg);
    } finally {
      setUploadBatchProgress(null);
      setBusy(false);
    }
  }, []);

  const retryOneExtraUpload = useCallback(async (objectId: string) => {
    const row = extraRowsRef.current.find((r) => r.objectId === objectId);
    if (!row || row.status !== "error") return;
    setBusy(true);
    const totalBytes = Math.max(1, row.file.size);
    setUploadBatchProgress({
      loaded: 0,
      total: totalBytes,
      label: row.file.name,
    });
    try {
      setExtraRows((prev) =>
        prev.map((r) =>
          r.objectId === objectId
            ? { ...r, status: "uploading" as const, error: undefined }
            : r,
        ),
      );
      await uploadFileToInventoryObject(
        row.objectId,
        row.file,
        row.uploadKind,
        (pe) => {
          setUploadBatchProgress({
            loaded: pe.loaded,
            total: Math.max(1, totalBytes),
            label: row.file.name,
          });
        },
      );
      setExtraRows((prev) =>
        prev.map((r) =>
          r.objectId === objectId
            ? { ...r, status: "done" as const, error: undefined }
            : r,
        ),
      );
      toast.success(`Uploaded: ${row.file.name}`);
    } catch (e) {
      const msg = inventoryUserFacingError(e);
      setExtraRows((prev) =>
        prev.map((r) =>
          r.objectId === objectId
            ? { ...r, status: "error" as const, error: msg }
            : r,
        ),
      );
      toast.error(msg);
    } finally {
      setUploadBatchProgress(null);
      setBusy(false);
    }
  }, []);

  const resolveLicense = useCallback(async (): Promise<{
    uri: string;
    cid: string;
  }> => {
    if (!agent || !session) throw new Error("Not signed in");
    if (!savedLicense) throw new Error("Select a license");
    return savedLicense;
  }, [agent, session, savedLicense]);

  const runPublish = useCallback(async () => {
    if (!sessionId || busy || !session?.did) return;
    const merchantDid = session.did;
    if (
      !step1Valid ||
      !audioRows.length ||
      audioRows.some((r) => !r.title.trim()) ||
      extraRows.some((r) => !r.title.trim()) ||
      !step3LicenseOk ||
      !reviewAcknowledged ||
      !uploadsComplete
    ) {
      toast.error(
        "Complete the checklist and confirm review before publishing.",
      );
      return;
    }
    if (
      audioRows.some(
        (r) =>
          r.rights.compositionPath === "existing" &&
          !r.rights.existingCompositionUri.trim(),
      )
    ) {
      toast.error(
        "Each track must either link an existing composition or use New composition.",
      );
      return;
    }
    setBusy(true);
    try {
      const resolvedArtworkObjectId = await uploadPendingReleaseArtwork();
      const lic = await resolveLicense();
      const itemSlots = [
        ...audioRows.map((r, i) => {
          let discNumber: number | undefined;
          if (r.discNumber.trim()) {
            const n = parseInt(r.discNumber, 10);
            if (Number.isFinite(n)) discNumber = n;
          }
          return {
            objectId: r.objectId,
            role: "track" as const,
            trackNumber: i + 1,
            discNumber,
            ...(r.allowIndividualPurchase
              ? { allowIndividualPurchase: true as const }
              : {}),
          };
        }),
        ...extraRows.map((r) => ({
          objectId: r.objectId,
          role: r.role,
          ...(r.allowIndividualPurchase
            ? { allowIndividualPurchase: true as const }
            : {}),
        })),
      ];

      const draft = {
        tracks: [
          ...audioRows.map((r) => ({
            objectId: r.objectId,
            title: r.title.trim(),
            itemClass: "track" as const,
            formats: [] as string[],
            durationMs: r.durationMs,
            isrc: r.isrc.trim() || undefined,
            description: r.description.trim() || undefined,
            rights: buildTrackRightsDraftForPublish(r.rights, merchantDid),
          })),
          ...extraRows.map((r) => ({
            objectId: r.objectId,
            title: r.title.trim(),
            itemClass: r.itemClass,
            formats: [] as string[],
            durationMs: r.durationMs,
            description: r.description.trim() || undefined,
          })),
        ],
        collection: {
          title: releaseTitle.trim(),
          collectionType,
          releaseDate: new Date(releaseDate).toISOString(),
          description: releaseDescription.trim() || undefined,
          genre: genreTags.length ? genreTags : undefined,
          upc: upc.trim() || undefined,
          artworkObjectId:
            resolvedArtworkObjectId ?? artworkObjectId ?? undefined,
          itemSlots,
        },
        licenseUri: lic.uri,
        licenseGrantCid: lic.cid,
      };

      await saveInventoryDraft(sessionId, draft);
      await publishInventorySession(sessionId);
      toast.success("Release published to your PDS.");
      skipLeaveGuardRef.current = true;
      navigate("/merchant/listings?source=upload");
    } catch (e) {
      toast.error(inventoryUserFacingError(e));
    } finally {
      setBusy(false);
    }
  }, [
    sessionId,
    busy,
    step1Valid,
    audioRows,
    extraRows,
    step3LicenseOk,
    reviewAcknowledged,
    uploadsComplete,
    resolveLicense,
    releaseTitle,
    collectionType,
    releaseDate,
    releaseDescription,
    genreTags,
    upc,
    artworkObjectId,
    navigate,
    session,
    uploadPendingReleaseArtwork,
  ]);

  const artworkRowUi = useMemo(() => {
    if (!artworkFile) {
      return {
        uploadingNow: false,
        badgeText: "",
        badgeClassName: "",
        detailLine: "",
      };
    }
    const uploadPhase =
      !!uploadBatchProgress &&
      busy &&
      uploadBatchProgress.label === artworkFile.name;
    const uploadingNow = artworkUploadBusy || uploadPhase;
    const done = !!artworkObjectId && !busy;
    const queued = !!artworkObjectId && busy && !uploadingNow;

    const badge = uploadingNow
      ? fileRowStatusBadge("uploading")
      : done
        ? fileRowStatusBadge("done")
        : queued
          ? fileRowStatusBadge("queued")
          : fileRowStatusBadge("pending");
    const badgeText = badge.text;
    const badgeClassName = badge.className;

    let detailLine: string;
    if (uploadingNow) {
      detailLine = artworkUploadBusy
        ? "Sending to your upload session…"
        : "Uploading bytes to storage…";
    } else if (done) {
      detailLine = "Saved to your upload session for this release.";
    } else if (queued) {
      detailLine = "Registered — finishing other files in this batch first…";
    } else if (audioRows.length === 0) {
      detailLine =
        "Included when you click Upload files to storage with your tracks.";
    } else {
      detailLine =
        "Should save automatically — use Replace if this stays on Pending.";
    }

    return {
      uploadingNow,
      badgeText,
      badgeClassName,
      detailLine,
    };
  }, [
    artworkFile,
    artworkObjectId,
    artworkUploadBusy,
    audioRows.length,
    busy,
    uploadBatchProgress,
  ]);

  if (!session || !agent) return null;

  const deferrableChecklist: string[] = [];
  if (!artworkObjectId && !artworkFile)
    deferrableChecklist.push("Release artwork");
  if (genreTags.length === 0) deferrableChecklist.push("Genre tags");
  if (!upc.trim()) deferrableChecklist.push("UPC");
  audioRows.forEach((r, i) => {
    if (!r.isrc.trim()) deferrableChecklist.push(`Track ${i + 1} ISRC`);
    if (!r.description.trim())
      deferrableChecklist.push(`Track ${i + 1} description`);
  });
  if (!releaseDescription.trim())
    deferrableChecklist.push("Release description (optional; not on PDS yet)");

  return (
    <article className="w-full min-w-0 max-w-3xl space-y-10 pb-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Upload release</h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Every release is a{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            collection
          </code>{" "}
          wrapping one{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            catalog.item.digital
          </code>{" "}
          per file. Listings (price, listing-level license) are created
          separately.
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-x-1 gap-y-1 text-sm text-muted-foreground border-b border-border pb-4"
        aria-label="Upload steps"
      >
        {(
          ["Release", "Tracks & files", "License", "Review & publish"] as const
        ).map((label, i) => {
          const n = i + 1;
          const active = n === step;
          const forwardBlocked =
            n > step &&
            ((n >= 2 && !step1Valid) ||
              (n >= 3 && !tracksMetaValid) ||
              (n >= 4 && !step3LicenseOk));
          return (
            <span key={label} className="inline-flex items-center gap-x-1">
              {i > 0 ? (
                <span className="text-border select-none px-0.5" aria-hidden>
                  /
                </span>
              ) : null}
              <button
                type="button"
                disabled={forwardBlocked}
                title={
                  forwardBlocked
                    ? "Complete the previous steps first"
                    : `Go to step ${n}`
                }
                onClick={() => goToStep(n)}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-left transition-colors",
                  active && "text-foreground font-medium",
                  !active &&
                    !forwardBlocked &&
                    "hover:text-foreground underline-offset-4 hover:underline",
                  forwardBlocked && "opacity-45 cursor-not-allowed",
                )}
              >
                Step {n} — {label}
              </button>
            </span>
          );
        })}
      </nav>

      {step === 1 ? (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,18rem)] lg:items-start">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rel-title">Release title</Label>
                <Input
                  id="rel-title"
                  value={releaseTitle}
                  onChange={(e) => setReleaseTitle(e.target.value)}
                  placeholder="Album or single name"
                />
              </div>
              <div className="space-y-2">
                <Label>Collection type</Label>
                <div className="flex flex-wrap gap-2">
                  {COLLECTION_TYPES.map((opt) => (
                    <Button
                      key={opt.value}
                      type="button"
                      size="sm"
                      variant={
                        collectionType === opt.value ? "default" : "outline"
                      }
                      onClick={() => setCollectionType(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rel-date">Release date</Label>
                <Input
                  id="rel-date"
                  type="date"
                  value={releaseDate.slice(0, 10)}
                  onChange={(e) => setReleaseDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="genre">Genre</Label>
                <Input
                  id="genre"
                  value={genreInput}
                  onChange={(e) => setGenreInput(e.target.value)}
                  placeholder="e.g. electronic, ambient"
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Comma-separated. Can be added or changed later.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rel-desc">Description</Label>
                <Textarea
                  id="rel-desc"
                  value={releaseDescription}
                  onChange={(e) => setReleaseDescription(e.target.value)}
                  rows={3}
                  placeholder="Optional. Can be edited after publishing."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="upc">UPC</Label>
                <Input
                  id="upc"
                  value={upc}
                  onChange={(e) => setUpc(e.target.value)}
                  placeholder="Optional"
                />
                <p className="text-xs text-muted-foreground">
                  Optional. bazaarPid is generated when the collection is
                  written.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Artwork</Label>
              <div className="overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-64 relative">
                {artworkPreviewUrl ? (
                  <div className="relative h-full w-full min-h-[8rem]">
                    <img
                      src={artworkPreviewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-2 p-2 bg-gradient-to-t from-background/90 to-transparent">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="text-xs"
                        onClick={() => {
                          setArtworkFile(null);
                          setArtworkObjectId(null);
                          setArtworkUploadKind(null);
                          setArtworkInventoryUploadDone(false);
                        }}
                      >
                        Remove artwork
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ImageDropzone
                    key="release-artwork"
                    aspectRatio="1:1"
                    className="h-full w-full max-w-none min-h-[8rem] rounded-none border-0 bg-transparent p-2 flex flex-col justify-center"
                    onFile={(f) => onReleaseArtworkChosen(f)}
                    onError={(m) => toast.error(m)}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                If you add it here, it still uploads on the next step with your
                audio (
                <span className="font-medium text-foreground">
                  Upload files
                </span>
                ), unless tracks are already on the server — then it uploads
                immediately. You can also add or change cover art on step 2.
              </p>
            </div>
          </div>
          <Button disabled={!step1Valid || busy} onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-8">
          {busy && uploadBatchProgress ? (
            <div
              className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 truncate font-medium">
                  {uploadBatchProgress.label}
                </span>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {uploadBatchProgress.itemIndex != null &&
                  uploadBatchProgress.itemTotal != null ? (
                    <span>
                      Item {uploadBatchProgress.itemIndex} /{" "}
                      {uploadBatchProgress.itemTotal}
                    </span>
                  ) : null}
                  <span>
                    {Math.min(
                      100,
                      Math.round(
                        (uploadBatchProgress.loaded /
                          uploadBatchProgress.total) *
                          100,
                      ),
                    )}
                    %
                  </span>
                </div>
              </div>
              <Progress
                value={Math.min(
                  100,
                  (uploadBatchProgress.loaded / uploadBatchProgress.total) *
                    100,
                )}
                className="h-2 w-full"
              />
            </div>
          ) : null}
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Tracks</h2>
            <p className="text-sm text-muted-foreground">
              Audio files are always{" "}
              <code className="text-xs">itemClass: track</code>. Upload sends
              bytes to storage; publish writes PDS records.
            </p>
            {audioRows.length === 0 ? (
              <>
                <BatchAudioFileDropzone
                  onBatch={appendStagedAudio}
                  onError={(m) => toast.error(m)}
                  hint="FLAC, WAV, MP3, AAC, OGG, M4A, Opus. Multiple files in one drop."
                />
                {stagedAudio.length > 0 ? (
                  <ol className="list-decimal list-inside space-y-1 text-sm border rounded-lg divide-y">
                    {stagedAudio.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-2 py-2 px-3"
                      >
                        <span className="truncate">
                          {e.meta.title || e.file.name}{" "}
                          <span className="text-muted-foreground tabular-nums">
                            {formatDuration(e.meta.durationMs)}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setStagedAudio((p) =>
                              p.filter((x) => x.id !== e.id),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </>
            ) : (
              <ol className="space-y-2 border rounded-lg divide-y">
                {audioRows.map((r, i) => {
                  const uploadBadge = fileRowStatusBadge(r.status);
                  return (
                    <li key={r.objectId} className="p-3 space-y-2">
                      <div className="flex flex-wrap items-start gap-2 justify-between">
                        <div className="flex min-w-0 flex-1 gap-3">
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="w-6 text-sm font-medium tabular-nums">
                              {i + 1}.
                            </span>
                            <div className="flex items-center gap-0.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                disabled={i === 0}
                                onClick={() => moveAudio(i, -1)}
                                aria-label="Move up"
                              >
                                ↑
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                disabled={i === audioRows.length - 1}
                                onClick={() => moveAudio(i, 1)}
                                aria-label="Move down"
                              >
                                ↓
                              </Button>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {r.title.trim() || stripExtension(r.file.name)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {formatDuration(r.durationMs)}
                              </span>
                              <span className="break-all">
                                {" "}
                                · {r.file.name}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span
                              className={cn(
                                "text-xs rounded-full px-2 py-0.5 border",
                                r.title.trim()
                                  ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                                  : "border-destructive/50 text-destructive",
                              )}
                            >
                              {r.title.trim() ? "OK" : "Title required"}
                            </span>
                            <span
                              className={cn(
                                "text-xs rounded-full px-2 py-0.5 border",
                                uploadBadge.className,
                              )}
                            >
                              {uploadBadge.text}
                            </span>
                            {r.status === "error" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={busy}
                                onClick={() => void retryOneAudioUpload(r.objectId)}
                              >
                                Retry
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive"
                              disabled={r.status === "uploading"}
                              onClick={() => removeAudioRow(r.objectId)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                      {r.error ? (
                        <p className="text-destructive text-xs">{r.error}</p>
                      ) : null}
                      <Input
                        placeholder="Title"
                        value={r.title}
                        onChange={(e) =>
                          setAudioRows((prev) =>
                            prev.map((x) =>
                              x.objectId === r.objectId
                                ? { ...x, title: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={r.allowIndividualPurchase}
                          onChange={(e) =>
                            setAudioRows((prev) =>
                              prev.map((x) =>
                                x.objectId === r.objectId
                                  ? {
                                      ...x,
                                      allowIndividualPurchase: e.target.checked,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        Allow individual purchase (separate listing for this track)
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 -ml-2"
                        onClick={() =>
                          setExpandedAudioId((id) =>
                            id === r.objectId ? null : r.objectId,
                          )
                        }
                      >
                        {expandedAudioId === r.objectId
                          ? "Hide details"
                          : "More metadata"}
                      </Button>
                      {expandedAudioId === r.objectId ? (
                        <div className="space-y-3 pl-1 border-l-2 border-muted ml-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Additional metadata — these fields can be filled or
                            updated after publishing.
                          </p>
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                              track
                            </span>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={r.showDisc}
                                onChange={(e) =>
                                  setAudioRows((prev) =>
                                    prev.map((x) =>
                                      x.objectId === r.objectId
                                        ? { ...x, showDisc: e.target.checked }
                                        : x,
                                    ),
                                  )
                                }
                              />
                              Disc number
                            </label>
                          </div>
                          {r.showDisc ? (
                            <Input
                              className="max-w-[6rem]"
                              inputMode="numeric"
                              placeholder="Disc"
                              value={r.discNumber}
                              onChange={(e) =>
                                setAudioRows((prev) =>
                                  prev.map((x) =>
                                    x.objectId === r.objectId
                                      ? { ...x, discNumber: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          ) : null}
                          <div className="space-y-1">
                            <Label className="text-xs">ISRC</Label>
                            <Input
                              value={r.isrc}
                              onChange={(e) =>
                                setAudioRows((prev) =>
                                  prev.map((x) =>
                                    x.objectId === r.objectId
                                      ? { ...x, isrc: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              placeholder="Optional"
                            />
                            <p className="text-xs text-muted-foreground">
                              Add when registered. A{" "}
                              <code className="text-[10px]">bazaarRid</code> is
                              generated automatically at publish (signed by the
                              Bazaar app key, like receipt{" "}
                              <code className="text-[10px]">appSig</code>).
                            </p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Description</Label>
                            <Textarea
                              rows={2}
                              value={r.description}
                              onChange={(e) =>
                                setAudioRows((prev) =>
                                  prev.map((x) =>
                                    x.objectId === r.objectId
                                      ? { ...x, description: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          <details className="rounded-md border border-border bg-muted/15 p-3 space-y-3">
                            <summary className="cursor-pointer text-sm font-medium">
                              Rights & ownership
                            </summary>
                            <p className="text-xs text-muted-foreground">
                              These fields establish ownership of the
                              composition and master recording. They can be
                              filled now or after publishing, but are required
                              before creating a sync or commercial listing.
                            </p>
                            <div className="flex flex-wrap gap-2 items-center">
                              <Button
                                type="button"
                                variant={
                                  r.rights.compositionPath === "new"
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() =>
                                  setAudioRows((prev) =>
                                    prev.map((x) =>
                                      x.objectId === r.objectId
                                        ? {
                                            ...x,
                                            rights: {
                                              ...x.rights,
                                              compositionPath: "new",
                                              existingCompositionUri: "",
                                              existingCompositionCid: "",
                                              existingBazaarWid: null,
                                              linkedCompositionSnapshot: null,
                                            },
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                New composition
                              </Button>
                              <Button
                                type="button"
                                variant={
                                  r.rights.compositionPath === "existing"
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() =>
                                  setCompositionPickerObjectId(r.objectId)
                                }
                              >
                                Link to existing composition
                              </Button>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Master owner (DID)
                              </Label>
                              <Input
                                className="font-mono text-xs"
                                value={r.rights.masterOwnerDid}
                                onChange={(e) =>
                                  setAudioRows((prev) =>
                                    prev.map((x) =>
                                      x.objectId === r.objectId
                                        ? {
                                            ...x,
                                            rights: {
                                              ...x.rights,
                                              masterOwnerDid: e.target.value,
                                            },
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                placeholder={session.did}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Publishing owner (DID)
                              </Label>
                              <Input
                                className="font-mono text-xs"
                                value={r.rights.publishingOwnerDid}
                                onChange={(e) =>
                                  setAudioRows((prev) =>
                                    prev.map((x) =>
                                      x.objectId === r.objectId
                                        ? {
                                            ...x,
                                            rights: {
                                              ...x.rights,
                                              publishingOwnerDid:
                                                e.target.value,
                                            },
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                placeholder={session.did}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Publishing owner IPI
                              </Label>
                              <Input
                                className="font-mono text-xs"
                                value={r.rights.publishingOwnerIpi}
                                onChange={(e) =>
                                  setAudioRows((prev) =>
                                    prev.map((x) =>
                                      x.objectId === r.objectId
                                        ? {
                                            ...x,
                                            rights: {
                                              ...x.rights,
                                              publishingOwnerIpi:
                                                e.target.value,
                                            },
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                placeholder="Add when you have your IPI number from your PRO"
                              />
                            </div>
                            {r.rights.compositionPath === "new" ? (
                              <>
                                <div className="space-y-1">
                                  <Label className="text-xs">
                                    Composition title
                                  </Label>
                                  <Input
                                    className="text-sm"
                                    value={r.rights.compositionTitle}
                                    onChange={(e) =>
                                      setAudioRows((prev) =>
                                        prev.map((x) =>
                                          x.objectId === r.objectId
                                            ? {
                                                ...x,
                                                rights: {
                                                  ...x.rights,
                                                  compositionTitle:
                                                    e.target.value,
                                                },
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                    placeholder={
                                      r.title || "Same as track title"
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">ISWC</Label>
                                  <Input
                                    className="font-mono text-xs"
                                    value={r.rights.iswc}
                                    onChange={(e) =>
                                      setAudioRows((prev) =>
                                        prev.map((x) =>
                                          x.objectId === r.objectId
                                            ? {
                                                ...x,
                                                rights: {
                                                  ...x.rights,
                                                  iswc: e.target.value,
                                                },
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                    placeholder="Add when assigned by your PRO"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">
                                    Work ID (bazaar:wid)
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
                                    Preview uses the canonical payload from the
                                    signing strategy (title + sorted writer keys
                                    + time). The real record uses the publish
                                    timestamp. Signature: Bazaar app service key
                                    (<code className="text-[10px]">appDid</code>
                                    ), not your personal ATProto key — same
                                    trust model as purchase receipts.
                                  </p>
                                  <BazaarWidLivePreview
                                    artistDid={session.did}
                                    compositionTitle={
                                      r.rights.compositionTitle.trim() ||
                                      r.title.trim() ||
                                      "Untitled work"
                                    }
                                    writers={r.rights.writers}
                                  />
                                </div>
                              </>
                            ) : (
                              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
                                <p className="font-medium text-foreground">
                                  Linked composition
                                </p>
                                {r.rights.linkedCompositionSnapshot ? (
                                  <ul className="text-muted-foreground space-y-1 list-disc pl-4">
                                    <li>
                                      Title:{" "}
                                      {r.rights.linkedCompositionSnapshot.title}
                                    </li>
                                    {r.rights.linkedCompositionSnapshot.iswc ? (
                                      <li>
                                        ISWC:{" "}
                                        {
                                          r.rights.linkedCompositionSnapshot
                                            .iswc
                                        }
                                      </li>
                                    ) : null}
                                    <li>
                                      Co-writers:{" "}
                                      {r.rights.linkedCompositionSnapshot
                                        .writers?.length ?? 0}
                                    </li>
                                    {r.rights.existingBazaarWid ? (
                                      <li className="font-mono break-all">
                                        bazaarWid:{" "}
                                        {r.rights.existingBazaarWid.id.slice(
                                          0,
                                          28,
                                        )}
                                        …
                                      </li>
                                    ) : null}
                                  </ul>
                                ) : (
                                  <p className="text-amber-600 dark:text-amber-500">
                                    Choose &quot;Link to existing
                                    composition&quot; to pick a work from your
                                    PDS.
                                  </p>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={() => {
                                    const snap =
                                      r.rights.linkedCompositionSnapshot;
                                    setAudioRows((prev) =>
                                      prev.map((x) => {
                                        if (x.objectId !== r.objectId) return x;
                                        if (!snap) {
                                          return {
                                            ...x,
                                            rights: {
                                              ...emptyTrackRights(session.did),
                                              masterOwnerDid:
                                                x.rights.masterOwnerDid,
                                              publishingOwnerDid:
                                                x.rights.publishingOwnerDid,
                                              publishingOwnerIpi:
                                                x.rights.publishingOwnerIpi,
                                              compositionPath: "new",
                                            },
                                          };
                                        }
                                        const writers: CoWriterForm[] = (
                                          snap.writers ?? []
                                        ).map((w) => ({
                                          id: crypto.randomUUID(),
                                          name: w.name ?? "",
                                          ipi: w.ipi ?? "",
                                          did: w.did ?? "",
                                          share:
                                            w.share != null
                                              ? String(w.share)
                                              : "",
                                          role: w.role ?? "",
                                        }));
                                        const publishers: PublisherForm[] = (
                                          snap.publishers ?? []
                                        ).map((p) => ({
                                          id: crypto.randomUUID(),
                                          name: p.name ?? "",
                                          ipi: p.ipi ?? "",
                                          did: p.did ?? "",
                                          pro: p.pro ?? "",
                                          share:
                                            p.share != null
                                              ? String(p.share)
                                              : "",
                                        }));
                                        const proRegistrations: ProRegForm[] = (
                                          snap.proRegistrations ?? []
                                        ).map((pr) => ({
                                          id: crypto.randomUUID(),
                                          pro: pr.pro,
                                          registrationId:
                                            pr.registrationId ?? "",
                                          territory: pr.territory ?? "",
                                        }));
                                        return {
                                          ...x,
                                          rights: {
                                            ...emptyTrackRights(session.did),
                                            masterOwnerDid:
                                              x.rights.masterOwnerDid,
                                            publishingOwnerDid:
                                              x.rights.publishingOwnerDid,
                                            publishingOwnerIpi:
                                              x.rights.publishingOwnerIpi,
                                            compositionPath: "new",
                                            compositionTitle: snap.title,
                                            iswc: snap.iswc ?? "",
                                            copyrightYear:
                                              snap.copyrightYear != null
                                                ? String(snap.copyrightYear)
                                                : "",
                                            copyrightRegistrationId:
                                              snap.copyrightRegistrationId ??
                                              "",
                                            writers,
                                            publishers,
                                            proRegistrations,
                                          },
                                        };
                                      }),
                                    );
                                  }}
                                >
                                  Edit as new composition
                                </Button>
                              </div>
                            )}
                            {r.rights.compositionPath === "new" ? (
                              <>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <Label className="text-xs">
                                      Co-writers
                                    </Label>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        setAudioRows((prev) =>
                                          prev.map((x) =>
                                            x.objectId === r.objectId
                                              ? {
                                                  ...x,
                                                  rights: {
                                                    ...x.rights,
                                                    writers: [
                                                      ...x.rights.writers,
                                                      {
                                                        id: crypto.randomUUID(),
                                                        name: "",
                                                        ipi: "",
                                                        did: "",
                                                        share: "",
                                                        role: "",
                                                      },
                                                    ],
                                                  },
                                                }
                                              : x,
                                          ),
                                        )
                                      }
                                    >
                                      Add writer
                                    </Button>
                                  </div>
                                  <ul className="space-y-2">
                                    {r.rights.writers.map((w) => (
                                      <li
                                        key={w.id}
                                        className="grid gap-2 sm:grid-cols-2 border rounded p-2"
                                      >
                                        <Input
                                          className="text-xs sm:col-span-2"
                                          placeholder="Name"
                                          value={w.name}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        writers:
                                                          x.rights.writers.map(
                                                            (y) =>
                                                              y.id === w.id
                                                                ? {
                                                                    ...y,
                                                                    name: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs font-mono"
                                          placeholder="IPI"
                                          value={w.ipi}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        writers:
                                                          x.rights.writers.map(
                                                            (y) =>
                                                              y.id === w.id
                                                                ? {
                                                                    ...y,
                                                                    ipi: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs font-mono"
                                          placeholder="DID (optional)"
                                          value={w.did}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        writers:
                                                          x.rights.writers.map(
                                                            (y) =>
                                                              y.id === w.id
                                                                ? {
                                                                    ...y,
                                                                    did: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs"
                                          placeholder="Share %"
                                          inputMode="decimal"
                                          value={w.share}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        writers:
                                                          x.rights.writers.map(
                                                            (y) =>
                                                              y.id === w.id
                                                                ? {
                                                                    ...y,
                                                                    share:
                                                                      e.target
                                                                        .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Select
                                          value={w.role || WRITER_ROLE_NONE}
                                          onValueChange={(v) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        writers:
                                                          x.rights.writers.map(
                                                            (y) =>
                                                              y.id === w.id
                                                                ? {
                                                                    ...y,
                                                                    role:
                                                                      v ==
                                                                        null ||
                                                                      v ===
                                                                        WRITER_ROLE_NONE
                                                                        ? ""
                                                                        : v,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        >
                                          <SelectTrigger className="text-xs h-8">
                                            <SelectValue placeholder="Role" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {WRITER_ROLE_OPTIONS.map((opt) => (
                                              <SelectItem
                                                key={opt.value}
                                                value={opt.value}
                                              >
                                                {opt.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 text-xs sm:col-span-2 justify-self-start"
                                          onClick={() =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        writers:
                                                          x.rights.writers.filter(
                                                            (y) =>
                                                              y.id !== w.id,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        >
                                          Remove writer
                                        </Button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <Label className="text-xs">
                                      Publishers
                                    </Label>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        setAudioRows((prev) =>
                                          prev.map((x) =>
                                            x.objectId === r.objectId
                                              ? {
                                                  ...x,
                                                  rights: {
                                                    ...x.rights,
                                                    publishers: [
                                                      ...x.rights.publishers,
                                                      {
                                                        id: crypto.randomUUID(),
                                                        name: "",
                                                        ipi: "",
                                                        did: "",
                                                        pro: "",
                                                        share: "",
                                                      },
                                                    ],
                                                  },
                                                }
                                              : x,
                                          ),
                                        )
                                      }
                                    >
                                      Add publisher
                                    </Button>
                                  </div>
                                  <ul className="space-y-2">
                                    {r.rights.publishers.map((p) => (
                                      <li
                                        key={p.id}
                                        className="grid gap-2 sm:grid-cols-2 border rounded p-2"
                                      >
                                        <Input
                                          className="text-xs sm:col-span-2"
                                          placeholder="Name"
                                          value={p.name}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        publishers:
                                                          x.rights.publishers.map(
                                                            (y) =>
                                                              y.id === p.id
                                                                ? {
                                                                    ...y,
                                                                    name: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs font-mono"
                                          placeholder="IPI"
                                          value={p.ipi}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        publishers:
                                                          x.rights.publishers.map(
                                                            (y) =>
                                                              y.id === p.id
                                                                ? {
                                                                    ...y,
                                                                    ipi: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs font-mono"
                                          placeholder="DID (optional)"
                                          value={p.did}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        publishers:
                                                          x.rights.publishers.map(
                                                            (y) =>
                                                              y.id === p.id
                                                                ? {
                                                                    ...y,
                                                                    did: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs"
                                          placeholder="PRO (e.g. ASCAP)"
                                          value={p.pro}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        publishers:
                                                          x.rights.publishers.map(
                                                            (y) =>
                                                              y.id === p.id
                                                                ? {
                                                                    ...y,
                                                                    pro: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs"
                                          placeholder="Share %"
                                          inputMode="decimal"
                                          value={p.share}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        publishers:
                                                          x.rights.publishers.map(
                                                            (y) =>
                                                              y.id === p.id
                                                                ? {
                                                                    ...y,
                                                                    share:
                                                                      e.target
                                                                        .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 text-xs sm:col-span-2 justify-self-start"
                                          onClick={() =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        publishers:
                                                          x.rights.publishers.filter(
                                                            (y) =>
                                                              y.id !== p.id,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        >
                                          Remove publisher
                                        </Button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <Label className="text-xs">
                                      PRO registrations
                                    </Label>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        setAudioRows((prev) =>
                                          prev.map((x) =>
                                            x.objectId === r.objectId
                                              ? {
                                                  ...x,
                                                  rights: {
                                                    ...x.rights,
                                                    proRegistrations: [
                                                      ...x.rights
                                                        .proRegistrations,
                                                      {
                                                        id: crypto.randomUUID(),
                                                        pro: "",
                                                        registrationId: "",
                                                        territory: "",
                                                      },
                                                    ],
                                                  },
                                                }
                                              : x,
                                          ),
                                        )
                                      }
                                    >
                                      Add registration
                                    </Button>
                                  </div>
                                  <ul className="space-y-2">
                                    {r.rights.proRegistrations.map((pr) => (
                                      <li
                                        key={pr.id}
                                        className="grid gap-2 sm:grid-cols-3 border rounded p-2"
                                      >
                                        <Input
                                          className="text-xs"
                                          placeholder="PRO name"
                                          value={pr.pro}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        proRegistrations:
                                                          x.rights.proRegistrations.map(
                                                            (y) =>
                                                              y.id === pr.id
                                                                ? {
                                                                    ...y,
                                                                    pro: e
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <Input
                                          className="text-xs font-mono"
                                          placeholder="Registration ID"
                                          value={pr.registrationId}
                                          onChange={(e) =>
                                            setAudioRows((prev) =>
                                              prev.map((x) =>
                                                x.objectId === r.objectId
                                                  ? {
                                                      ...x,
                                                      rights: {
                                                        ...x.rights,
                                                        proRegistrations:
                                                          x.rights.proRegistrations.map(
                                                            (y) =>
                                                              y.id === pr.id
                                                                ? {
                                                                    ...y,
                                                                    registrationId:
                                                                      e.target
                                                                        .value,
                                                                  }
                                                                : y,
                                                          ),
                                                      },
                                                    }
                                                  : x,
                                              ),
                                            )
                                          }
                                        />
                                        <div className="flex gap-2 sm:col-span-3">
                                          <Input
                                            className="text-xs font-mono max-w-[4rem]"
                                            placeholder="CC"
                                            maxLength={2}
                                            value={pr.territory}
                                            onChange={(e) =>
                                              setAudioRows((prev) =>
                                                prev.map((x) =>
                                                  x.objectId === r.objectId
                                                    ? {
                                                        ...x,
                                                        rights: {
                                                          ...x.rights,
                                                          proRegistrations:
                                                            x.rights.proRegistrations.map(
                                                              (y) =>
                                                                y.id === pr.id
                                                                  ? {
                                                                      ...y,
                                                                      territory:
                                                                        e.target
                                                                          .value,
                                                                    }
                                                                  : y,
                                                            ),
                                                        },
                                                      }
                                                    : x,
                                                ),
                                              )
                                            }
                                          />
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-xs"
                                            onClick={() =>
                                              setAudioRows((prev) =>
                                                prev.map((x) =>
                                                  x.objectId === r.objectId
                                                    ? {
                                                        ...x,
                                                        rights: {
                                                          ...x.rights,
                                                          proRegistrations:
                                                            x.rights.proRegistrations.filter(
                                                              (y) =>
                                                                y.id !== pr.id,
                                                            ),
                                                        },
                                                      }
                                                    : x,
                                                ),
                                              )
                                            }
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2 pt-1">
                                  <div className="space-y-1">
                                    <Label className="text-xs">
                                      Copyright year
                                    </Label>
                                    <Input
                                      className="text-xs"
                                      inputMode="numeric"
                                      placeholder="e.g. 2026"
                                      value={r.rights.copyrightYear}
                                      onChange={(e) =>
                                        setAudioRows((prev) =>
                                          prev.map((x) =>
                                            x.objectId === r.objectId
                                              ? {
                                                  ...x,
                                                  rights: {
                                                    ...x.rights,
                                                    copyrightYear:
                                                      e.target.value,
                                                  },
                                                }
                                              : x,
                                          ),
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1 sm:col-span-2">
                                    <Label className="text-xs">
                                      Copyright registration ID
                                    </Label>
                                    <Input
                                      className="text-xs font-mono"
                                      placeholder="US Copyright Office PA number or equivalent"
                                      value={r.rights.copyrightRegistrationId}
                                      onChange={(e) =>
                                        setAudioRows((prev) =>
                                          prev.map((x) =>
                                            x.objectId === r.objectId
                                              ? {
                                                  ...x,
                                                  rights: {
                                                    ...x.rights,
                                                    copyrightRegistrationId:
                                                      e.target.value,
                                                  },
                                                }
                                              : x,
                                          ),
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                              </>
                            ) : null}
                          </details>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Release artwork</h2>
            <p className="text-sm text-muted-foreground">
              Square cover (min 600×600). Same upload session as your tracks;
              optional.
            </p>
            {artworkPreviewUrl && artworkFile ? (
              <ol className="space-y-2 border rounded-lg divide-y">
                <li className="p-3 space-y-2">
                  <div className="flex flex-wrap items-start gap-2 justify-between">
                    <div className="flex gap-3 min-w-0 flex-1">
                      <img
                        src={artworkPreviewUrl}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-md object-cover ring-1 ring-border"
                      />
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {artworkFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {artworkRowUi.detailLine}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {artworkRowUi.badgeText ? (
                          <span
                            className={cn(
                              "text-xs rounded-full px-2 py-0.5 border",
                              artworkRowUi.badgeClassName,
                            )}
                          >
                            {artworkRowUi.badgeText}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          disabled={artworkRowUi.uploadingNow}
                          onClick={() => {
                            setArtworkFile(null);
                            setArtworkObjectId(null);
                            setArtworkUploadKind(null);
                            setArtworkInventoryUploadDone(false);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      <input
                        ref={step2ArtworkReplaceInputRef}
                        id={step2ArtworkReplaceInputId}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={artworkRowUi.uploadingNow}
                        onChange={async (ev) => {
                          const f = ev.target.files?.[0];
                          ev.target.value = "";
                          if (!f) return;
                          const ok = await validateSquareArtworkFile(f, (m) =>
                            toast.error(m),
                          );
                          if (ok) onReleaseArtworkChosen(f);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full max-w-[12rem] text-xs sm:w-auto"
                        disabled={artworkRowUi.uploadingNow}
                        onClick={() =>
                          step2ArtworkReplaceInputRef.current?.click()
                        }
                      >
                        Replace
                      </Button>
                    </div>
                  </div>
                </li>
              </ol>
            ) : (
              <div
                className={cn(
                  "rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors",
                  "hover:bg-muted/40 focus-within:border-ring",
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (!f) return;
                  const ok = await validateSquareArtworkFile(f, (m) =>
                    toast.error(m),
                  );
                  if (ok) onReleaseArtworkChosen(f);
                }}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  id={step2ArtworkEmptyInputId}
                  disabled={artworkRowUi.uploadingNow}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const ok = await validateSquareArtworkFile(f, (m) =>
                      toast.error(m),
                    );
                    if (ok) onReleaseArtworkChosen(f);
                  }}
                />
                <label
                  htmlFor={step2ArtworkEmptyInputId}
                  className="cursor-pointer text-sm text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    Drop cover image
                  </span>{" "}
                  or browse
                </label>
                <p className="mt-2 text-xs text-muted-foreground">
                  JPEG, PNG, or WebP. Minimum 600×600 px. Optional.
                </p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Additional material</h2>
            <p className="text-xs text-muted-foreground">
              Non-audio files become extra{" "}
              <code className="text-xs">catalog.item.digital</code> records in
              the collection (PDF, video, etc.).
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Item class</span> is
              stored on the item record (what kind of digital good it is).{" "}
              <span className="font-medium text-foreground">
                Collection role
              </span>{" "}
              is separate: it controls how the file appears in the release’s
              item list (e.g. bonus vs booklet). They are two different fields
              in the data model, so both are shown here.
            </p>
            {audioRows.length === 0 ? (
              <div
                className="rounded-lg border-2 border-dashed border-border p-6 text-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files);
                  for (const file of files) {
                    if (file.type.startsWith("audio/")) {
                      toast.message("Audio belongs in Tracks", {
                        description: "Use the tracks drop zone above.",
                      });
                      continue;
                    }
                    setStagedExtra((prev) => [
                      ...prev,
                      { id: crypto.randomUUID(), file },
                    ]);
                  }
                  void ensureSession().catch(() => {});
                }}
              >
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  id="extra-files"
                  onChange={(ev) => {
                    const files = ev.target.files
                      ? Array.from(ev.target.files)
                      : [];
                    for (const file of files) {
                      if (file.type.startsWith("audio/")) {
                        toast.message("Audio belongs in Tracks", {
                          description: "Use the tracks drop zone above.",
                        });
                        continue;
                      }
                      setStagedExtra((prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), file },
                      ]);
                    }
                    void ensureSession().catch(() => {});
                    ev.target.value = "";
                  }}
                />
                <label
                  htmlFor="extra-files"
                  className="cursor-pointer text-sm text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    Drop PDFs, video, images, or other files
                  </span>{" "}
                  or browse
                </label>
              </div>
            ) : null}
            {stagedExtra.length > 0 && audioRows.length === 0 ? (
              <ul className="border rounded-lg divide-y text-sm">
                {stagedExtra.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="truncate">{s.file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setStagedExtra((p) => p.filter((x) => x.id !== s.id))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {extraRows.length > 0 ? (
              <ul className="border rounded-lg divide-y text-sm space-y-0">
                {extraRows.map((r) => {
                  const uploadBadge = fileRowStatusBadge(r.status);
                  return (
                    <li key={r.objectId} className="p-3 space-y-2">
                      <div className="flex flex-wrap items-start gap-2 justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {r.title.trim() || stripExtension(r.file.name)}
                          </p>
                          <p className="text-xs text-muted-foreground break-all">
                            {r.itemClass} · {r.role} · {r.file.name}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span
                              className={cn(
                                "text-xs rounded-full px-2 py-0.5 border",
                                uploadBadge.className,
                              )}
                            >
                              {uploadBadge.text}
                            </span>
                            {r.status === "error" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={busy}
                                onClick={() => void retryOneExtraUpload(r.objectId)}
                              >
                                Retry
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive"
                              disabled={r.status === "uploading"}
                              onClick={() => removeExtraRow(r.objectId)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                      {r.error ? (
                        <p className="text-destructive text-xs">{r.error}</p>
                      ) : null}
                      <Input
                        placeholder="Title"
                        value={r.title}
                        onChange={(e) =>
                          setExtraRows((prev) =>
                            prev.map((x) =>
                              x.objectId === r.objectId
                                ? { ...x, title: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Item class</Label>
                          <Select
                            value={r.itemClass}
                            onValueChange={(v) => {
                              const ic = v as ExtraRowState["itemClass"];
                              setExtraRows((prev) =>
                                prev.map((x) =>
                                  x.objectId === r.objectId
                                    ? {
                                        ...x,
                                        itemClass: ic,
                                        role: defaultRoleForItemClass(
                                          ic,
                                          x.file,
                                        ),
                                      }
                                    : x,
                                ),
                              );
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EXTRA_ITEM_CLASSES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Collection role</Label>
                          <Select
                            value={r.role}
                            onValueChange={(v) =>
                              setExtraRows((prev) =>
                                prev.map((x) =>
                                  x.objectId === r.objectId
                                    ? { ...x, role: v as CollectionItemRole }
                                    : x,
                                ),
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                [
                                  "video",
                                  "document",
                                  "artwork",
                                  "bonus",
                                  "other",
                                ] as const
                              ).map((role) => (
                                <SelectItem key={role} value={role}>
                                  {role}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={r.allowIndividualPurchase}
                          onChange={(e) =>
                            setExtraRows((prev) =>
                              prev.map((x) =>
                                x.objectId === r.objectId
                                  ? {
                                      ...x,
                                      allowIndividualPurchase: e.target.checked,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        Allow individual purchase (separate listing)
                      </label>
                      <Textarea
                        rows={2}
                        placeholder="Description (optional)"
                        value={r.description}
                        onChange={(e) =>
                          setExtraRows((prev) =>
                            prev.map((x) =>
                              x.objectId === r.objectId
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            {audioRows.length === 0 ? (
              <Button
                type="button"
                disabled={
                  busy || stagedAudio.length === 0 || audioRows.length > 0
                }
                onClick={() => void registerAndUploadAll()}
              >
                Upload files to storage
              </Button>
            ) : needsResumeUpload ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void resumeInventoryUploads()}
              >
                Resume upload
              </Button>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={!tracksMetaValid} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            This license is stored as{" "}
            <code className="text-xs rounded bg-muted px-1">license.terms</code>{" "}
            and set as{" "}
            <code className="text-xs rounded bg-muted px-1">
              defaultLicenseUri
            </code>{" "}
            on your collection. Listing checkout still uses the listing record.
          </p>
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              Why licenses are reused
            </summary>
            <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
              A license record is published once and reused across listings.
              Buyers who purchase under a given license retain those exact terms
              permanently — changing your license on a future listing does not
              affect past purchases.
            </p>
          </details>
          <div className="space-y-2">
            {licenseRowsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : licenseRows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground space-y-2">
                <p>No license records in your repo yet.</p>
                <Link
                  to="/merchant/license"
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  Create a license
                </Link>
              </div>
            ) : (
              <>
                <div className="grid gap-2 max-h-72 overflow-y-auto">
                  {licenseRows.map((row) => {
                    const picked =
                      savedLicense?.uri === row.uri &&
                      savedLicense?.cid === row.cid;
                    return (
                      <button
                        key={row.uri}
                        type="button"
                        onClick={() =>
                          setSavedLicense({ uri: row.uri, cid: row.cid })
                        }
                        className={cn(
                          "rounded-lg border p-3 text-left text-sm",
                          picked && "ring-2 ring-ring bg-muted/30",
                        )}
                      >
                        <p className="font-medium">{row.terms.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {row.terms.version}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <Link
                  to="/merchant/license"
                  className="text-sm text-primary underline-offset-2 hover:underline"
                >
                  Don't see the right license? Create one
                </Link>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button disabled={!step3LicenseOk} onClick={() => setStep(4)}>
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-6">
          <div className="rounded-lg border bg-muted/20 p-4 space-y-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Completeness</span>
              <span
                className={cn(
                  "tabular-nums font-semibold",
                  recommendedScore >= 80
                    ? "text-emerald-600 dark:text-emerald-400"
                    : recommendedScore >= 60
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-destructive",
                )}
              >
                {recommendedScore}
                <span className="text-muted-foreground font-normal"> / 100</span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Advisory only — artwork, genres, UPC, release description, ISRCs,
              and track descriptions raise this score but do not block publishing.
              License terms are chosen in step 3 and can be adjusted again at
              listing time.
            </p>
            {recommendedScore < 50 ? (
              <p className="text-muted-foreground text-xs">
                Consider adding more optional metadata for a richer catalog
                record.
              </p>
            ) : recommendedScore < 80 ? (
              <p className="text-amber-700 dark:text-amber-400 text-xs">
                Good coverage — aim for 80+ if you want a strong storefront
                profile.
              </p>
            ) : (
              <p className="text-emerald-700 dark:text-emerald-400 text-xs">
                Strong optional metadata coverage.
              </p>
            )}
          </div>

          <section className="space-y-2 text-sm">
            <div className="flex justify-between items-baseline">
              <h3 className="font-medium">Release</h3>
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setStep(1)}
              >
                Edit
              </Button>
            </div>
            <dl className="grid gap-1 text-muted-foreground">
              <div>
                <dt className="inline text-foreground">Title:</dt>{" "}
                {releaseTitle || "—"}
              </div>
              <div>
                <dt className="inline text-foreground">Type:</dt>{" "}
                {collectionType}
              </div>
              <div>
                <dt className="inline text-foreground">Date:</dt>{" "}
                {releaseDate || "—"}
              </div>
              <div>
                <dt className="inline text-foreground">Artwork:</dt>{" "}
                {artworkObjectId || artworkFile ? "Yes" : "Deferred"}
              </div>
            </dl>
          </section>

          <section className="space-y-2 text-sm">
            <div className="flex justify-between items-baseline">
              <h3 className="font-medium">Tracks</h3>
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setStep(2)}
              >
                Edit
              </Button>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              {audioRows.map((r) => (
                <li key={r.objectId}>
                  {r.title} ({formatDuration(r.durationMs)})
                  {r.isrc.trim() ? ` · ISRC ${r.isrc}` : ""}
                  {r.allowIndividualPurchase ? " · individual listing" : ""}
                </li>
              ))}
            </ol>
            {extraRows.length > 0 ? (
              <>
                <h4 className="text-xs font-medium text-foreground pt-2">
                  Additional material
                </h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  {extraRows.map((r) => (
                    <li key={r.objectId}>
                      {r.title} · {r.itemClass} · {r.role}
                      {r.allowIndividualPurchase ? " · individual listing" : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="space-y-2 text-sm">
            <div className="flex justify-between items-baseline">
              <h3 className="font-medium">License</h3>
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setStep(3)}
              >
                Edit
              </Button>
            </div>
            <p className="text-muted-foreground">
              {savedLicense
                ? `Saved record (${savedLicense.uri.slice(0, 40)}…)`
                : "—"}
            </p>
          </section>

          {deferrableChecklist.length > 0 ? (
            <div className="rounded-lg border border-dashed p-4 space-y-2 text-sm">
              <p className="font-medium">
                You can fill these in later from inventory
              </p>
              <ul className="list-disc list-inside text-muted-foreground text-xs space-y-0.5">
                {deferrableChecklist.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={reviewAcknowledged}
              onChange={(e) => setReviewAcknowledged(e.target.checked)}
              className="mt-1 rounded border-input"
            />
            <span>
              I have reviewed this summary. I understand that publish writes{" "}
              <code className="text-xs">license.terms</code> (if using a
              template), digital items, and the collection to my PDS.
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button disabled={!canPublish} onClick={() => void runPublish()}>
              {busy ? "Publishing…" : "Confirm & publish"}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={compositionPickerObjectId != null}
        onOpenChange={(open) => {
          if (!open) {
            setCompositionPickerObjectId(null);
            setCompositionSearch("");
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link existing composition</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Picks a <code className="text-[10px]">catalog.composition</code>{" "}
            from your PDS. <code className="text-[10px]">bazaarWid</code> is
            copied onto the recording; no new composition record is written.
          </p>
          <Input
            placeholder="Search by title"
            value={compositionSearch}
            onChange={(e) => setCompositionSearch(e.target.value)}
            className="my-3"
          />
          <ul className="space-y-2">
            {compositionRows
              .filter((row) =>
                row.composition.title
                  .toLowerCase()
                  .includes(compositionSearch.trim().toLowerCase()),
              )
              .map((row) => {
                const wid = parseBazaarIdentifierClient(
                  row.composition.bazaarWid,
                );
                return (
                  <li key={row.uri}>
                    <button
                      type="button"
                      className="w-full text-left rounded border border-border p-2 hover:bg-muted/50 text-sm"
                      onClick={() => {
                        if (!compositionPickerObjectId) return;
                        const bid = parseBazaarIdentifierClient(
                          row.composition.bazaarWid,
                        );
                        setAudioRows((prev) =>
                          prev.map((x) =>
                            x.objectId === compositionPickerObjectId
                              ? {
                                  ...x,
                                  rights: {
                                    ...x.rights,
                                    compositionPath: "existing",
                                    existingCompositionUri: row.uri,
                                    existingCompositionCid: row.cid,
                                    existingBazaarWid: bid,
                                    linkedCompositionSnapshot: row.composition,
                                    iswc: row.composition.iswc ?? "",
                                  },
                                }
                              : x,
                          ),
                        );
                        setCompositionPickerObjectId(null);
                        setCompositionSearch("");
                      }}
                    >
                      <p className="font-medium">{row.composition.title}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">
                        {wid ? `${wid.id.slice(0, 28)}…` : "—"}
                      </p>
                    </button>
                  </li>
                );
              })}
          </ul>
          {compositionRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No compositions in your PDS yet. Use &quot;New composition&quot;
              for this track.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </article>
  );
}
