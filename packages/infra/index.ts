import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Buckets:
 * - `primary` — app assets + Litestream DB backups (S3 API keys from the dashboard).
 * - `pulumiState` — holds Pulumi stack state via the S3-compatible backend (same style of R2 keys).
 *
 * Bootstrap (once): Pulumi cannot store state in a bucket it is still creating.
 * 1. `pulumi login file://$PWD/.pulumi-bootstrap` (or any writable path).
 * 2. `pulumi up` with `CLOUDFLARE_API_TOKEN` set — creates both buckets.
 * 3. Create an R2 **S3 API** token with read/write on the state bucket (and primary if needed).
 * 4. `pulumi stack export > stack.json` then
 *    `pulumi login 's3://<state-bucket>?endpoint=https://<accountId>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true'`
 *    with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` exported.
 * 5. `pulumi stack import --file stack.json`
 *
 * After that, set `PULUMI_BACKEND_URL` in CI to the same `s3://...` URL and the AWS env vars.
 */
const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");

const bucket = new cloudflare.R2Bucket("primary", {
  accountId,
  name: config.get("bucketName") ?? `bazaar-${pulumi.getStack()}`,
  location: config.get("location") ?? "WNAM",
});

const pulumiStateBucket = new cloudflare.R2Bucket("pulumi-state", {
  accountId,
  name:
    config.get("pulumiStateBucketName") ??
    `bazaar-pulumi-state-${pulumi.getStack()}`,
  location: config.get("location") ?? "WNAM",
});

/** S3 API endpoint for R2 (Litestream, Pulumi state backend, aws-sdk, etc.). */
export const r2S3Endpoint = pulumi.interpolate`https://${accountId}.r2.cloudflarestorage.com`;

export const r2BucketName = bucket.name;
export const pulumiStateBucketName = pulumiStateBucket.name;

/** Use as `PULUMI_BACKEND_URL` after bootstrap (with AWS_* R2 S3 credentials). */
export const pulumiBackendUrl = pulumi.interpolate`s3://${pulumiStateBucket.name}?endpoint=https://${accountId}.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true`;

export const r2AccountId = pulumi.Output.create(accountId);
