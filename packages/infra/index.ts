import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Buckets:
 * - `primary` — app assets + Litestream DB backups (S3 API keys from the dashboard). One per stack (`bazaar-${stack}`).
 * - `pulumiState` — Pulumi state backend on R2. **Only the `prod` stack creates this bucket.** Other stacks (`stg`, `dev`, …)
 *   reuse the same `PULUMI_BACKEND_URL` as prod. If prod used a custom name, set `sharedPulumiStateBucketName` on non-prod stacks
 *   so stack outputs match the real bucket.
 *
 * Bootstrap (once): Pulumi cannot store state in a bucket it is still creating.
 * 1. `pulumi login file://$PWD/.pulumi-bootstrap` (or any writable path).
 * 2. On stack **`prod`** only: `pulumi up` with `CLOUDFLARE_API_TOKEN` set — creates primary + state buckets.
 * 3. Create an R2 **S3 API** token with read/write on the state bucket (and primary buckets as needed).
 * 4. `pulumi stack export > stack.json` then
 *    `pulumi login 's3://<state-bucket>?endpoint=https://<accountId>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true'`
 *    with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` exported.
 * 5. `pulumi stack import --file stack.json`
 *
 * Then `pulumi stack init stg` (etc.) and `pulumi up`: only `bazaar-stg` is created; state stays in the existing bucket.
 * In CI you can set `CLOUDFLARE_ACCOUNT_ID` (secret) instead of `pulumi config` so nothing sensitive is committed.
 */
const config = new pulumi.Config();
const accountId =
  process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
  config.require("cloudflareAccountId");

const stack = pulumi.getStack();
const isProdStack = stack === "prod";

const bucket = new cloudflare.R2Bucket("primary", {
  accountId,
  name: config.get("bucketName") ?? `bazaar-${stack}`,
  location: config.get("location") ?? "WNAM",
});

const stateBucketPhysicalName =
  config.get("pulumiStateBucketName") ?? `bazaar-pulumi-state-${stack}`;

const pulumiStateBucket = isProdStack
  ? new cloudflare.R2Bucket("pulumi-state", {
      accountId,
      name: stateBucketPhysicalName,
      location: config.get("location") ?? "WNAM",
    })
  : undefined;

/** Name of the shared state bucket (for outputs / PULUMI_BACKEND_URL); non-prod stacks do not create it. */
const pulumiStateBucketNameOut: pulumi.Output<string> = isProdStack
  ? pulumiStateBucket!.name
  : pulumi.output(
      config.get("sharedPulumiStateBucketName") ?? "bazaar-pulumi-state-prod",
    );

/** S3 API endpoint for R2 (Litestream, Pulumi state backend, aws-sdk, etc.). */
export const r2S3Endpoint = pulumi.interpolate`https://${accountId}.r2.cloudflarestorage.com`;

export const r2BucketName = bucket.name;
export const pulumiStateBucketName = pulumiStateBucketNameOut;

/** Use as `PULUMI_BACKEND_URL` after bootstrap (with AWS_* R2 S3 credentials). */
export const pulumiBackendUrl = pulumi.interpolate`s3://${pulumiStateBucketNameOut}?endpoint=https://${accountId}.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true`;

export const r2AccountId = pulumi.Output.create(accountId);
