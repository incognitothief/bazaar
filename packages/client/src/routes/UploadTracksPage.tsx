import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  publishInventorySession,
  registerInventoryObjects,
  saveInventoryDraft,
  uploadFileToInventoryObject,
} from "@/lib/api/inventoryApi";
import { Progress } from "@/components/ui/progress";
import {
  LICENSE_TEMPLATE_COMPLEXITY_META,
  LICENSE_TEMPLATE_COMPLEXITY_ORDER,
  licenseTemplatesForComplexity,
  type LicenseTemplateComplexity,
  type LicenseTemplateId,
} from "@bazaar/shared";
import {
  createLicenseTerms,
  findLicenseByTemplateId,
  licenseTermsPayloadFromTemplateId,
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
};

type ExtraRowState = RegRow & {
  title: string;
  itemClass: (typeof EXTRA_ITEM_CLASSES)[number];
  role: CollectionItemRole;
  essential: boolean;
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

function computeRecommendedScore(input: {
  hasArtwork: boolean;
  genreTags: string[];
  upc: string;
  audioRows: AudioRowState[];
}): number {
  let s = 0;
  if (input.hasArtwork) s += 15;
  if (input.genreTags.length > 0) s += 10;
  if (input.upc.trim()) s += 5;
  const n = input.audioRows.length || 1;
  const isrcAvg =
    input.audioRows.filter((r) => r.isrc.trim()).length / n;
  s += Math.round(10 * isrcAvg);
  const descAvg =
    input.audioRows.filter((r) => r.description.trim()).length / n;
  s += Math.round(5 * descAvg);
  s += 10;
  return Math.min(95, s);
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
  const [compositionRows, setCompositionRows] = useState<CompositionRow[]>(
    [],
  );
  const [compositionSearch, setCompositionSearch] = useState("");

  const [busy, setBusy] = useState(false);
  const [uploadBatchProgress, setUploadBatchProgress] = useState<{
    loaded: number;
    total: number;
    label: string;
  } | null>(null);

  const [licensePickMode, setLicensePickMode] = useState<"saved" | "template">(
    "saved",
  );
  const [savedLicense, setSavedLicense] = useState<{
    uri: string;
    cid: string;
  } | null>(null);
  const [licenseTemplateId, setLicenseTemplateId] =
    useState<LicenseTemplateId | null>("personal-use");
  const [licenseRows, setLicenseRows] = useState<LicenseTermsRow[]>([]);
  const [licenseRowsLoading, setLicenseRowsLoading] = useState(false);

  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const sessionInflightRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!compositionPickerObjectId || !agent || !session) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCompositionRows(agent, session.did);
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

  const appendStagedAudio = useCallback(
    (entries: BatchAudioEntry[]) => {
      if (entries.length === 0) return;
      void (async () => {
        try {
          await ensureSession();
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "Could not start upload session",
          );
          return;
        }
        setStagedAudio((prev) => {
          const seen = new Set(prev.map((e) => `${e.file.name}-${e.file.size}`));
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

  const step1Valid =
    !!releaseTitle.trim() &&
    !!releaseDate.trim();

  const uploadsComplete =
    audioRows.length > 0 &&
    audioRows.every((r) => r.status === "done") &&
    extraRows.every((r) => r.status === "done");

  const tracksMetaValid =
    uploadsComplete &&
    audioRows.every((r) => r.title.trim()) &&
    extraRows.every((r) => r.title.trim());

  const step3LicenseOk =
    licensePickMode === "saved"
      ? !!savedLicense
      : !!licenseTemplateId && !!licenseTermsPayloadFromTemplateId(licenseTemplateId);

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
    audioRows,
  });

  const canPublish =
    requiredGateOk && recommendedScore >= 60 && uploadsComplete && !busy;

  useEffect(() => {
    if (step !== 3 || !agent || !session?.did) return;
    let cancelled = false;
    setLicenseRowsLoading(true);
    void listLicenseTermsRows(agent, session.did)
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
    const totalBytes =
      stagedAudio.reduce((s, e) => s + e.file.size, 0) +
      stagedExtra.reduce((s, e) => s + e.file.size, 0) +
      (artworkFile?.size ?? 0);
    setBusy(true);
    setUploadBatchProgress({
      loaded: 0,
      total: Math.max(1, totalBytes),
      label: "Preparing upload…",
    });
    let doneBase = 0;
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
      if (artworkFile) {
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
        artworkFile && reg.objects.length > nAudio + nExtra
          ? reg.objects[nAudio + nExtra]
          : null;
      setArtworkObjectId(artReg?.objectId ?? null);

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
          essential: true,
          description: "",
        };
      });
      setAudioRows(nextAudio);
      setExtraRows(nextExtra);
      setStagedAudio([]);
      setStagedExtra([]);

      const allMasters = [...nextAudio, ...nextExtra];
      for (let i = 0; i < allMasters.length; i++) {
        const row = allMasters[i]!;
        if (i < nextAudio.length) {
          const idx = i;
          setAudioRows((prev) =>
            prev.map((r, j) =>
              j === idx ? { ...r, status: "uploading" as const } : r,
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
                });
              },
            );
            doneBase += row.file.size;
            setAudioRows((prev) =>
              prev.map((r, j) =>
                j === idx ? { ...r, status: "done" as const } : r,
              ),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setAudioRows((prev) =>
              prev.map((r, j) =>
                j === idx
                  ? { ...r, status: "error" as const, error: msg }
                  : r,
              ),
            );
            throw err;
          }
        } else {
          const idx = i - nextAudio.length;
          setExtraRows((prev) =>
            prev.map((r, j) =>
              j === idx ? { ...r, status: "uploading" as const } : r,
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
                });
              },
            );
            doneBase += row.file.size;
            setExtraRows((prev) =>
              prev.map((r, j) =>
                j === idx ? { ...r, status: "done" as const } : r,
              ),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setExtraRows((prev) =>
              prev.map((r, j) =>
                j === idx
                  ? { ...r, status: "error" as const, error: msg }
                  : r,
              ),
            );
            throw err;
          }
        }
      }

      if (artworkFile && artReg) {
        await uploadFileToInventoryObject(
          artReg.objectId,
          artworkFile,
          artReg.uploadKind,
          (pe) => {
            setUploadBatchProgress({
              loaded: doneBase + pe.loaded,
              total: Math.max(1, totalBytes),
              label: artworkFile.name,
            });
          },
        );
      }

      toast.success("Files uploaded — continue to license.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadBatchProgress(null);
      setBusy(false);
    }
  }, [ensureSession, stagedAudio, stagedExtra, artworkFile, session]);

  const resolveLicense = useCallback(async (): Promise<{
    uri: string;
    cid: string;
  }> => {
    if (!agent || !session) throw new Error("Not signed in");
    if (licensePickMode === "saved") {
      if (!savedLicense) throw new Error("Select a license");
      return savedLicense;
    }
    const tid = licenseTemplateId;
    if (!tid) throw new Error("Select a template");
    const payload = licenseTermsPayloadFromTemplateId(tid);
    if (!payload) throw new Error("Invalid license template");
    const existing = await findLicenseByTemplateId(agent, session.did, tid);
    if (existing) return { uri: existing.uri, cid: existing.cid };
    const lic = await createLicenseTerms(agent, payload);
    return { uri: lic.uri, cid: lic.cid };
  }, [agent, session, licensePickMode, savedLicense, licenseTemplateId]);

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
      recommendedScore < 60 ||
      !uploadsComplete
    ) {
      toast.error("Complete the checklist and confirm review before publishing.");
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
            essential: true,
            trackNumber: i + 1,
            discNumber,
          };
        }),
        ...extraRows.map((r) => ({
          objectId: r.objectId,
          role: r.role,
          essential: r.essential,
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
          genre: genreTags.length ? genreTags : undefined,
          upc: upc.trim() || undefined,
          artworkObjectId: artworkObjectId ?? undefined,
          itemSlots,
        },
        licenseUri: lic.uri,
        licenseGrantCid: lic.cid,
      };

      await saveInventoryDraft(sessionId, draft);
      const snap = await publishInventorySession(sessionId);
      toast.success("Release published to your PDS.");
      navigate("/merchant/dashboard", {
        state: {
          listingPrefillPath: `/merchant/listings?prefillItemUri=${encodeURIComponent(snap.primaryItemUri)}`,
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
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
    recommendedScore,
    uploadsComplete,
    resolveLicense,
    releaseTitle,
    collectionType,
    releaseDate,
    genreTags,
    upc,
    artworkObjectId,
    navigate,
    session,
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
          <code className="text-xs rounded bg-muted px-1 py-0.5">collection</code>{" "}
          wrapping one{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            catalog.item.digital
          </code>{" "}
          per file. Listings (price, listing-level license) are created separately.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground border-b border-border pb-4">
        {(
          [
            "Release",
            "Tracks & files",
            "License",
            "Review & publish",
          ] as const
        ).map((label, i) => (
          <span
            key={label}
            className={cn(
              i + 1 === step && "text-foreground font-medium",
            )}
          >
            Step {i + 1} — {label}
          </span>
        ))}
      </div>

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
                      variant={collectionType === opt.value ? "default" : "outline"}
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
                  placeholder="Optional — not stored on the collection record yet."
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
                  Optional. bazaarPid is generated when the collection is written.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Artwork</Label>
              <div className="overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-64">
                <ImageDropzone
                  key="release-artwork"
                  aspectRatio="1:1"
                  className="h-full w-full max-w-none min-h-[8rem] rounded-none border-0 bg-transparent p-2 flex flex-col justify-center"
                  onFile={(f) => {
                    setArtworkFile(f);
                    void ensureSession().catch((e) =>
                      toast.error(
                        e instanceof Error ? e.message : "Session error",
                      ),
                    );
                  }}
                  onError={(m) => toast.error(m)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Recommended. Visible on your storefront. Can be added later from
                inventory.
              </p>
            </div>
          </div>
          <Button disabled={!step1Valid} onClick={() => setStep(2)}>
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
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">
                  {uploadBatchProgress.label}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
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
              <Progress
                value={Math.min(
                  100,
                  (uploadBatchProgress.loaded / uploadBatchProgress.total) * 100,
                )}
                className="h-2 w-full"
              />
            </div>
          ) : null}
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Tracks</h2>
            <p className="text-sm text-muted-foreground">
              Audio files are always{" "}
              <code className="text-xs">itemClass: track</code>. Upload sends bytes to
              storage; publish writes PDS records.
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
                            setStagedAudio((p) => p.filter((x) => x.id !== e.id))
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
                {audioRows.map((r, i) => (
                  <li key={r.objectId} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium tabular-nums w-6">
                          {i + 1}.
                        </span>
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
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDuration(r.durationMs)} · {r.status}
                      </span>
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
                            These fields establish ownership of the composition
                            and master recording. They can be filled now or
                            after publishing, but are required before creating a
                            sync or commercial listing.
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
                            <Label className="text-xs">Master owner (DID)</Label>
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
                                            publishingOwnerDid: e.target.value,
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
                                            publishingOwnerIpi: e.target.value,
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
                                  placeholder={r.title || "Same as track title"}
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
                                  timestamp. Signature: Bazaar app service key (
                                  <code className="text-[10px]">appDid</code>),
                                  not your personal ATProto key — same trust
                                  model as purchase receipts.
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
                                      {r.rights.linkedCompositionSnapshot.iswc}
                                    </li>
                                  ) : null}
                                  <li>
                                    Co-writers:{" "}
                                    {r.rights.linkedCompositionSnapshot.writers
                                      ?.length ?? 0}
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
                                  Choose &quot;Link to existing composition&quot;
                                  to pick a work from your PDS.
                                </p>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => {
                                  const snap = r.rights.linkedCompositionSnapshot;
                                  setAudioRows((prev) =>
                                    prev.map((x) => {
                                      if (x.objectId !== r.objectId) return x;
                                      if (!snap) {
                                        return {
                                          ...x,
                                          rights: {
                                            ...emptyTrackRights(session.did),
                                            masterOwnerDid: x.rights.masterOwnerDid,
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
                                          masterOwnerDid: x.rights.masterOwnerDid,
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
                                            snap.copyrightRegistrationId ?? "",
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
                              <Label className="text-xs">Co-writers</Label>
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
                                                  writers: x.rights.writers.map(
                                                    (y) =>
                                                      y.id === w.id
                                                        ? {
                                                            ...y,
                                                            name: e.target.value,
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
                                                  writers: x.rights.writers.map(
                                                    (y) =>
                                                      y.id === w.id
                                                        ? {
                                                            ...y,
                                                            ipi: e.target.value,
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
                                                  writers: x.rights.writers.map(
                                                    (y) =>
                                                      y.id === w.id
                                                        ? {
                                                            ...y,
                                                            did: e.target.value,
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
                                                  writers: x.rights.writers.map(
                                                    (y) =>
                                                      y.id === w.id
                                                        ? {
                                                            ...y,
                                                            share:
                                                              e.target.value,
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
                                                  writers: x.rights.writers.map(
                                                    (y) =>
                                                      y.id === w.id
                                                        ? {
                                                            ...y,
                                                            role:
                                                              v == null ||
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
                                                      (y) => y.id !== w.id,
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
                              <Label className="text-xs">Publishers</Label>
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
                                                              name: e.target
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
                                                              ipi: e.target
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
                                                              did: e.target
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
                                                              pro: e.target
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
                                                                e.target.value,
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
                                                      (y) => y.id !== p.id,
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
                                                ...x.rights.proRegistrations,
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
                                                              pro: e.target
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
                                                                e.target.value,
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
                                                        (y) => y.id !== pr.id,
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
                ))}
              </ol>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Additional material</h2>
            <p className="text-xs text-muted-foreground">
              Non-audio files become extra{" "}
              <code className="text-xs">catalog.item.digital</code> records in the
              collection (PDF, video, etc.).
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
                {extraRows.map((r) => (
                  <li key={r.objectId} className="p-3 space-y-2">
                    <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{r.file.name}</span>
                      <span>{r.status}</span>
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
                    <div className="flex flex-wrap gap-2">
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
                                    role: defaultRoleForItemClass(ic, x.file),
                                  }
                                : x,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="w-[140px]">
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
                        <SelectTrigger className="w-[140px]">
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
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={r.essential}
                          onChange={(e) =>
                            setExtraRows((prev) =>
                              prev.map((x) =>
                                x.objectId === r.objectId
                                  ? { ...x, essential: e.target.checked }
                                  : x,
                              ),
                            )
                          }
                        />
                        Essential
                      </label>
                    </div>
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
                ))}
              </ul>
            ) : null}
          </section>

          {audioRows.length === 0 ? (
            <Button
              type="button"
              disabled={
                busy ||
                stagedAudio.length === 0 ||
                audioRows.length > 0
              }
              onClick={() => void registerAndUploadAll()}
            >
              Upload files to storage
            </Button>
          ) : null}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              disabled={!tracksMetaValid}
              onClick={() => setStep(3)}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            This license is stored as{" "}
            <code className="text-xs rounded bg-muted px-1">license.terms</code> and
            set as{" "}
            <code className="text-xs rounded bg-muted px-1">defaultLicenseUri</code>{" "}
            on your collection. Listing checkout still uses the listing record.
          </p>
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              Why licenses are reused
            </summary>
            <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
              A license record is published once and reused across listings. Buyers who
              purchase under a given license retain those exact terms permanently —
              changing your license on a future listing does not affect past purchases.
            </p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={licensePickMode === "saved" ? "default" : "outline"}
              size="sm"
              onClick={() => setLicensePickMode("saved")}
            >
              Saved on my PDS
            </Button>
            <Button
              type="button"
              variant={licensePickMode === "template" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setLicensePickMode("template");
                setSavedLicense(null);
              }}
            >
              Templates
            </Button>
          </div>
          {licensePickMode === "saved" ? (
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
                    Open license page
                  </Link>
                </div>
              ) : (
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
                          {row.terms.tier} · {row.terms.rightsType}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6 max-h-[min(60vh,420px)] overflow-y-auto pr-1">
              <p className="text-xs font-medium text-muted-foreground">
                Templates — not yet published to your storefront until you confirm at
                publish.
              </p>
              {LICENSE_TEMPLATE_COMPLEXITY_ORDER.map(
                (complexity: LicenseTemplateComplexity) => {
                  const meta = LICENSE_TEMPLATE_COMPLEXITY_META[complexity];
                  const templates = licenseTemplatesForComplexity(complexity);
                  return (
                    <div key={complexity} className="space-y-2">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <div className="grid gap-2">
                        {templates.map((def) => (
                          <button
                            key={def.id}
                            type="button"
                            onClick={() => {
                              setLicenseTemplateId(def.id);
                              setSavedLicense(null);
                            }}
                            className={cn(
                              "rounded-lg border p-3 text-left text-sm",
                              licenseTemplateId === def.id && "ring-2 ring-ring",
                            )}
                          >
                            <p className="font-medium">{def.record.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {def.record.summary}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
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
                <span className="text-muted-foreground font-normal"> / 95</span>
              </span>
            </div>
            {recommendedScore < 60 ? (
              <p className="text-destructive text-xs">
                Score must be at least 60 to publish. Add artwork, genres, UPC, or
                enrich track metadata.
              </p>
            ) : recommendedScore < 80 ? (
              <p className="text-amber-700 dark:text-amber-400 text-xs">
                Consider adding more metadata for a stronger release (target 80+).
              </p>
            ) : (
              <p className="text-emerald-700 dark:text-emerald-400 text-xs">
                Strong metadata coverage.
              </p>
            )}
          </div>

          <section className="space-y-2 text-sm">
            <div className="flex justify-between items-baseline">
              <h3 className="font-medium">Release</h3>
              <Button variant="link" className="h-auto p-0" onClick={() => setStep(1)}>
                Edit
              </Button>
            </div>
            <dl className="grid gap-1 text-muted-foreground">
              <div>
                <dt className="inline text-foreground">Title:</dt>{" "}
                {releaseTitle || "—"}
              </div>
              <div>
                <dt className="inline text-foreground">Type:</dt> {collectionType}
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
              <Button variant="link" className="h-auto p-0" onClick={() => setStep(2)}>
                Edit
              </Button>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              {audioRows.map((r) => (
                <li key={r.objectId}>
                  {r.title} ({formatDuration(r.durationMs)})
                  {r.isrc.trim() ? ` · ISRC ${r.isrc}` : ""}
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
                      {r.essential ? "" : " · non-essential"}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="space-y-2 text-sm">
            <div className="flex justify-between items-baseline">
              <h3 className="font-medium">License</h3>
              <Button variant="link" className="h-auto p-0" onClick={() => setStep(3)}>
                Edit
              </Button>
            </div>
            <p className="text-muted-foreground">
              {licensePickMode === "saved" && savedLicense
                ? `Saved record (${savedLicense.uri.slice(0, 40)}…)`
                : licenseTemplateId
                  ? `Template: ${licenseTemplateId}`
                  : "—"}
            </p>
          </section>

          {deferrableChecklist.length > 0 ? (
            <div className="rounded-lg border border-dashed p-4 space-y-2 text-sm">
              <p className="font-medium">You can fill these in later from inventory</p>
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
              <code className="text-xs">license.terms</code> (if using a template),
              digital items, and the collection to my PDS.
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button
              disabled={!canPublish}
              onClick={() => void runPublish()}
            >
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
            Picks a{" "}
            <code className="text-[10px]">catalog.composition</code> from your
            PDS. <code className="text-[10px]">bazaarWid</code> is copied onto
            the recording; no new composition record is written.
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
              No compositions in your PDS yet. Use &quot;New composition&quot; for
              this track.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

    </article>
  );
}
