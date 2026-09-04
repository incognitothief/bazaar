/** Actionable hints when R2 returns AccessDenied (wrong token scope, bucket name, or keys). */
export function r2AccessDeniedHints(bucket: string): string[] {
  return [
    `Cloudflare Dashboard → R2 → your bucket "${bucket}" → Manage R2 API Tokens: create or edit a token with **Object Read & Write** (or Admin Read & Write) on **this bucket** — not only Account read.`,
    "Confirm **R2_BUCKET_NAME** matches the bucket name exactly (case-sensitive).",
    "Confirm **CF_ACCOUNT_ID** is your Cloudflare **account** ID (Dashboard sidebar / API tokens page), not a Zone ID.",
    "Use the **Access Key ID** and **Secret Access Key** from that R2 S3 API token (not an unrelated Cloudflare API token).",
    "After changing .env, restart the API process.",
    "Call **GET /api/inventory/r2-status** (while signed in as a merchant) to verify **HeadBucket** succeeds before retrying upload.",
    "If **r2-status** returns headBucket ok but upload still fails AccessDenied, the token may be **read-only** — add **Object Write** (Object Read & Write) for that bucket.",
  ];
}

export function isR2AccessDenied(name: string, message: string): boolean {
  const n = name.toLowerCase();
  const m = message.toLowerCase();
  return (
    n.includes("accessdenied") ||
    m.includes("access denied") ||
    m.includes("403")
  );
}

export function isS3NoSuchKey(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { name?: string; Code?: string };
  return o.name === "NoSuchKey" || o.Code === "NoSuchKey";
}
