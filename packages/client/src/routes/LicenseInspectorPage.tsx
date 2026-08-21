import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { browserApiUrl } from "@/lib/browserApi";

type InspectedLicense = {
  cid: string;
  uri: string;
  title: string;
  version: string;
  licenseText: string;
  checkoutConsentRequired: boolean;
  capturedAt: string;
};

/**
 * Public, CID-addressed license view. Always reads from the server's
 * capture table, never the PDS — a license's content must stay viewable
 * even after the merchant edits or retires the record it came from.
 */
export function LicenseInspectorPage() {
  const { cid } = useParams<{ cid: string }>();
  const [license, setLicense] = useState<InspectedLicense | null>(null);
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
    fetch(browserApiUrl(`/api/licenses/${encodeURIComponent(cid)}`))
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setStatus("not_found");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data = (await res.json()) as InspectedLicense;
        setLicense(data);
        setStatus("found");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
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

  return (
    <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {license.title}
        </h1>
        <p className="text-muted-foreground">Version {license.version}</p>
      </div>

      <p className="whitespace-pre-wrap">{license.licenseText}</p>

      <p className="text-xs text-muted-foreground">
        <code className="break-all">{license.cid}</code>
      </p>
    </article>
  );
}
