import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { getRecordValueWithCid } from "@/lib/atproto/records";
import { browserApiUrl } from "@/lib/browserApi";
import { pdslsRecordUrl } from "@/lib/pdsls";
import type { LicenseTerms } from "@/types/lexicons";

type CapturedLicense = {
  cid: string;
  uri: string;
  title: string;
  version: string;
  licenseText: string;
  checkoutConsentRequired: boolean;
  capturedAt: string;
};

type DisplayLicense = {
  cid: string;
  uri: string;
  title: string;
  version: string;
  licenseText: string;
  /** True when the live PDS record no longer resolves to this CID (deleted,
   * or content otherwise changed) and we're showing the captured copy instead. */
  retired: boolean;
};

/**
 * Public, CID-addressed license view. Prefers the live PDS record when it
 * still resolves to the exact CID requested; falls back to the write-time
 * capture table otherwise (record deleted, DID unresolvable, etc.) so a
 * license stays viewable even after the merchant retires the record it came
 * from. The capture table is also what makes the PDS lookup possible at
 * all — it's the only place the record's URI is remembered.
 */
export function LicenseInspectorPage() {
  const { cid } = useParams<{ cid: string }>();
  const [license, setLicense] = useState<DisplayLicense | null>(null);
  const [status, setStatus] = useState<"loading" | "found" | "not_found" | "error">(
    "loading",
  );

  useEffect(() => {
    if (!cid) {
      setStatus("not_found");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      let captured: CapturedLicense;
      try {
        const res = await fetch(
          browserApiUrl(`/api/licenses/${encodeURIComponent(cid)}`),
        );
        if (cancelled) return;
        if (res.status === 404) {
          setStatus("not_found");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        captured = (await res.json()) as CapturedLicense;
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled) return;

      const live = await getRecordValueWithCid<LicenseTerms>(captured.uri);
      if (cancelled) return;

      // "Retired" means the CID's content is no longer the current content
      // at this URI -- genuinely gone, deleted, or superseded. A shape
      // mismatch (a still-live pre-reshape record with no licenseText) is
      // NOT retirement -- it's still exactly the current, active record,
      // it just needs to render differently. Only fall back to the
      // captured copy, and only mark Retired, when the live fetch actually
      // failed or came back with different content than requested.
      if (live && live.cid === cid) {
        const rawLive = live.value as unknown as Record<string, unknown>;
        const licenseText =
          typeof rawLive.licenseText === "string"
            ? rawLive.licenseText
            : JSON.stringify(rawLive, null, 2);
        setLicense({
          cid,
          uri: captured.uri,
          title: typeof rawLive.title === "string" ? rawLive.title : captured.title,
          version:
            typeof rawLive.version === "string" ? rawLive.version : captured.version,
          licenseText,
          retired: false,
        });
      } else {
        setLicense({
          cid: captured.cid,
          uri: captured.uri,
          title: captured.title,
          version: captured.version,
          licenseText: captured.licenseText,
          retired: true,
        });
      }
      setStatus("found");
    })();
    return () => {
      cancelled = true;
    };
  }, [cid]);

  if (status === "loading") {
    return (
      <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
        <p className="text-muted-foreground">Loading…</p>
      </article>
    );
  }

  if (status === "not_found" || status === "error") {
    return (
      <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold tracking-tight">
          License not found
        </h1>
        <p className="text-muted-foreground">
          {status === "error"
            ? "Something went wrong loading this license. Please try again."
            : "This license hasn't been recorded, or it no longer exists."}
        </p>
      </article>
    );
  }

  if (!license) return null;

  const pdslsHref = pdslsRecordUrl(license.uri);

  return (
    <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {license.title}
          </h1>
          {license.retired ? (
            <Badge variant="secondary">Retired</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground">Version {license.version}</p>
        {license.retired ? (
          <p className="text-xs text-muted-foreground">
            This record has been removed or changed on the merchant's PDS
            since this license was created. Showing the terms as they were
            at that time.
          </p>
        ) : null}
      </div>

      <p className="whitespace-pre-wrap">{license.licenseText}</p>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <code className="break-all">{license.cid}</code>
        {pdslsHref ? (
          <a
            href={pdslsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            View raw record on pdsls
          </a>
        ) : null}
      </div>
    </article>
  );
}
