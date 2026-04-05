import { S3Client } from "@aws-sdk/client-s3";
import type { r2ConfigFromEnv } from "./env";

type R2Ok = Extract<ReturnType<typeof r2ConfigFromEnv>, { ok: true }>;

let cached: { key: string; client: S3Client } | null = null;

function cacheKey(cfg: R2Ok): string {
  return `${cfg.endpoint}\0${cfg.bucket}\0${cfg.accessKeyId}`;
}

/**
 * S3 client for Cloudflare R2.
 * - forcePathStyle: required for R2’s S3-compatible endpoint.
 * - requestChecksumCalculation / responseChecksumValidation: default SDK v3 behavior sends
 *   flexible checksum headers (e.g. CRC32) that R2 often rejects with 501 NotImplemented.
 * @see https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
 */
export function getR2S3Client(cfg: R2Ok): S3Client {
  const key = cacheKey(cfg);
  if (cached?.key !== key) {
    cached = {
      key,
      client: new S3Client({
        region: "auto",
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    };
  }
  return cached.client;
}
