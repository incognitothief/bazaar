# Bazaar

Note: Must be set up on github in order to deploy to fly.io. (`fly` only supports github)

## Setting up infra with `pulumi` for the first time

This is some pre-cursory bootstrapping for your stack. We have to create it locally first before integrating it into the automated CI workflow

_run_

```
pulumi login file://~/.pulumi
cd packages/infra
pulumi init prod
pulumi select prod
```

## Setting up Cloudflare account

These are manual steps that need to be performed in the cloudfront dashboard

- Make a cloudflare account
- Create an API token for Workers R2 Storage:Edit
- Go to the R2 Dashboard and subscribe to the R2 service
- Run in your terminal

```
export CLOUDFLARE_API_TOKEN="your-token"
pulumi up
```

## migrating the local stack to cloud

_following the steps in `packages/infra/index.ts`_

- Create an S3 API Key (different than account API key)
- Run

```
pulumi stack export > stack.json
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
pulumi login 's3://<state-bucket>?endpoint=https://<accountId>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true'
pulumi stack init prod
pulumi stack select prod
pulumi stack import --file stack.json
```

## Setting up secrets

Make sure to set all the secrets for your GH Action to deploy

GitHub repository secrets (Settings → Secrets and variables → Actions):

- CLOUDFLARE_API_TOKEN — Cloudflare API (Pulumi provider)
- CLOUDFLARE_ACCOUNT_ID — same as bazaar-infra:cloudflareAccountId
- PULUMI_CONFIG_PASSPHRASE — if the stack uses passphrase-encrypted config secrets
- PULUMI_BACKEND_URL — s3://… R2 backend URL (query params for endpoint/region)
- AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — R2 S3 API keys (R2 → Manage R2 API Tokens), NOT the Cloudflare API token.
  Must allow read+write on the SAME bucket as PULUMI_BACKEND_URL (incl. ListBucket). Scoped-only-to-primary-bucket tokens → 403 on .pulumi/meta.yaml.
- FLY_API_TOKEN — deploy token for the Fly org that owns `app` in fly.toml (`fly tokens create deploy`, or https://fly.io/dashboard/personal/tokens ). Wrong/missing token → `unauthorized`.

The action will run on push and deploy the application

## Setting up Fly runtime secrets (server env)

The GitHub secrets above are CI/deploy-only — the running app never reads them. Server env vars
(`packages/server/.env.example`) must be set separately on each Fly app:

```
fly secrets set KEY=value -a <app>   # bazaar-g5nqca (prod) / bazaar-jwkvxw (staging)
```

At minimum:

- `ARTIST_DID` — store owner DID, required for `/api/merchant/*`
- `APP_MERCHANT_PRIVATE_KEY` — signs receipts/consent and `bazaarRid`/`bazaarWid`/`bazaarPid`
- Inventory uploads: `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- **Litestream DB backups — a separate credential set from the one above, all four required
  together**: `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`. If even one
  of these four is missing, `docker-entrypoint.sh` silently runs the app with **no backups** — no
  error, no log line. After setting them, confirm Litestream is actually running via `fly logs`
  right after a restart (it prints its own startup lines) — don't just trust that the vars are set.

See `packages/server/.env.example` for the full list of server env vars.

## Create a DID for the bazaar instance

Your storefront needs an identifier. Create one using the included script:

_run_

```bash
npm i
chmod 700 scripts/gen-did.sh
./scripts/gen-did.sh
```

be sure to save all of this information somewhere secure. Without it, you will not be able to prove ownership of your store

## Setting up OAuth

make sure you have a domain for your store. If have a domain registered elsewhere, you can point it to your fly.io app hostname by creating a certificate. The certificate window will instruct you what records to create

## Allowing multipart uploads direct to R2

Set CORS settings on bucket to point to your bazaar instance. This will speed up upload times. Defaults to uploading files through backend proxy

## GH level secrets are half for client injection, half for CICD (not to be confused with inventory bucket/server config)
