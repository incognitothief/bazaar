/** R2 / S3-compatible config (Cloudflare). `R2_BUCKET_NAME` must name a bucket that already exists. */
export function r2ConfigFromEnv():
  | {
      ok: true;
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      endpoint: string;
    }
  | { ok: false; reason: string } {
  const accountId = process.env.CF_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId)
    return { ok: false, reason: "CF_ACCOUNT_ID is not set" };
  if (!accessKeyId)
    return { ok: false, reason: "R2_ACCESS_KEY_ID is not set" };
  if (!secretAccessKey)
    return { ok: false, reason: "R2_SECRET_ACCESS_KEY is not set" };
  if (!bucket)
    return { ok: false, reason: "R2_BUCKET_NAME is not set" };
  return {
    ok: true,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}
