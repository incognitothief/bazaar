import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Provisions a single R2 bucket for multimedia and Litestream SQLite backups.
 *
 * Litestream uses the S3-compatible R2 API. Create **R2** → **Manage R2 API Tokens**
 * in the Cloudflare dashboard for `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
 * (Object Read & Write on this bucket). Pulumi cannot create those keys today via
 * the Cloudflare provider; this stack outputs the bucket name and endpoint only.
 */
const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");

const bucket = new cloudflare.R2Bucket("primary", {
  accountId,
  name: config.get("bucketName") ?? `bazaar-${pulumi.getStack()}`,
  location: config.get("location") ?? "WNAM",
});

/** S3 API endpoint for R2 (Litestream, aws-sdk, etc.). */
export const r2S3Endpoint = pulumi.interpolate`https://${accountId}.r2.cloudflarestorage.com`;

export const r2BucketName = bucket.name;
export const r2AccountId = pulumi.Output.create(accountId);
