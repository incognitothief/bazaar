**TASK: Integrate Cloudflare R2 into `packages/server`**

**Stack:** Hono on Bun, Turbo monorepo

---

**1. Install dependencies**

```
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
```

---

**2. Environment variables required**

```
CF_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

Bucket must be private. No public access. All delivery is via presigned URLs.

---

**3. Initialize the S3 client**

```ts
import { S3Client } from "@aws-sdk/client-s3";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
```

---

**4. R2 key naming convention**

```
inventory/{artistDid}/digital/{itemTid}/{filename}
```

Deterministic from the AT-URI. No DB lookup needed to reconstruct the key at download time.

---

**5. Upload handler — `POST /api/upload/digital`**

- Authenticated via ATProto OAuth session. Reject unauthenticated requests.
- Stream the file body to R2 via `PutObjectCommand`. Do not buffer in memory.
- Compute `fileChecksum` (SHA-256 hex digest) and `fileCid` (IPLD CID) from the received bytes server-side before or during the S3 write. Neither is derived from any PDS operation.
- Read `durationMs` from file metadata at upload time. Only populate for audio/video. Omit for documents and other non-time-based itemClass values.
- Set `fileFormat` to the MIME type of the uploaded source file.
- Return `{ r2Key, fileChecksum, fileCid, fileFormat, durationMs }` to the client. The client uses these values to write the `catalog.item.digital` PDS record via ATProto OAuth. The server does not write PDS records in this handler.

---

**6. Download handler — `GET /api/download?itemUri=at://...`**

- Buyer identity is the authenticated ATProto session DID.
- Fetch `diamonds.whereditgo.bazaar.purchase.receipt` records from the buyer's PDS.
- Find a receipt where `item.uri === itemUri`. For collection purchases, also check receipts where `item.itemType === catalog.collection` — resolve that collection and check whether the requested item appears in `items` with `essential: true`. Use the item's `collectionUri` field to check that collection first.
- Verify `appSig` on the receipt: reconstruct `SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)` and verify against the app service public key. Reject if invalid.
- Reconstruct the R2 key deterministically from the itemUri. Generate a presigned GET URL with 15-minute TTL.
- Return `{ url, expiresAt }`. Client redirects the browser to the URL. R2 serves the file directly.

```ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

async function generateDownloadUrl(r2Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: r2Key,
  });
  return getSignedUrl(r2, command, { expiresIn: 900 });
}
```

---

**7. Multipart uploads — defer**

For the initial build, implement standard `PutObjectCommand` only. Add multipart support (`CreateMultipartUploadCommand` / `UploadPartCommand` / `CompleteMultipartUploadCommand`) when stem packs or full lossless albums are in scope. Threshold: ~100MB.
