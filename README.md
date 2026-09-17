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

These are manual steps that need to be performed in the Cloudflare dashboard

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
- FLY_APP_NAME — your Fly app name, and FLY_APP_NAME_STG for staging. `fly.toml` and
  `fly.stg.toml` carry placeholders so the repo does not name anyone's deployment; the real
  name is passed with `--app` at deploy time. Locally, set `FLY_APP` instead.
- FLY_API_TOKEN — deploy token for the Fly org that owns the app (`fly tokens create deploy`, or https://fly.io/dashboard/personal/tokens ). Wrong/missing token → `unauthorized`.

The action will run on push and deploy the application

## Setting up Fly runtime secrets (server env)

The GitHub secrets above are CI/deploy-only — the running app never reads them. Server env vars
(`packages/server/.env.example`) must be set separately on each Fly app:

```
fly secrets set KEY=value -a <your-app>
```

At minimum:

- `MERCHANT_DID` — store owner DID, required for `/api/merchant/*`
- **Storefront signing identity — from `make storefront-key` (see below)**:
  `STOREFRONT_DID`, `STOREFRONT_PRIVATE_KEY`, `STOREFRONT_KID`,
  `STOREFRONT_PUBLIC_MULTIBASE`. These build the DID document served at
  `/.well-known/did.json`, which is how anyone verifies a receipt your store issued. If they
  are unset the app still starts, serves a DID document with no `verificationMethod`, and
  signs receipts nobody can verify — one warning line at boot is the only signal.
  (`STOREFRONT_KEY_HISTORY` is added later, on key rotation.)
- Cloudflare R2 — **inventory uploads and Litestream DB backups share one credential set**:
  `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. All four are
  required together. Without them the app starts with no backups and prints a line saying so.
  After setting them, confirm Litestream is actually running via `fly logs` right after a
  restart (it prints its own startup lines) — don't just trust that the vars are set.

See `packages/server/.env.example` for the full list of server env vars.

## Create the storefront identity

Your storefront is identified by a `did:web:` DID. AT Protocol resolves it by fetching
`https://<your-domain>/.well-known/did.json`, which this app serves — so the domain in the DID
must be the domain the store is reachable at.

```bash
npm i
make storefront-key DOMAIN=store.example.com
```

`DOMAIN` is the address your store is reachable at; pasting the URL straight from your browser
works. This writes a key file under `keys/` and prints the secrets to set:

```
fly secrets set -a <app> \
  STOREFRONT_DID=… STOREFRONT_KID=… STOREFRONT_PRIVATE_KEY=… STOREFRONT_PUBLIC_MULTIBASE=…
```

**Set them in one command.** Applying them separately leaves a window where the deployment has
part of an identity, and receipts signed in it will not verify.

Confirm it worked by fetching `https://<your-domain>/.well-known/did.json` — it should list a
`verificationMethod` whose fragment matches your `STOREFRONT_KID`.

### Your key files

`keys/` holds one file per key. **Keep them.** They are what lets a later rotation rebuild
`STOREFRONT_KEY_HISTORY`; without them you cannot prove past receipts came from your store.

They contain private keys in plain text. They are gitignored and excluded from Docker builds,
but keep them out of shared folders and backups, and delete any you are sure you no longer need.

Re-running `make storefront-key` with key files present re-prints the secrets without
generating anything — use it when setting up a new deployment from the same identity.

### Rotating the key

```bash
make storefront-key-rotate
```

A new key becomes active; the old one is marked **retired** — still listed in the DID document
and still trusted for receipts it already signed. You get an updated block including
`STOREFRONT_KEY_HISTORY`; set all of it together.

### Revoking a key

```bash
make storefront-key-revoke KID=storefront-key-2026-09-16
```

Use this when a key **leaked**, not when rotating on schedule. A revoked key is dropped from the
DID document, and receipts naming it are rejected outright — including ones that were signed
legitimately before the leak. Rotate first; the active key cannot be revoked.

## Setting up OAuth

make sure you have a domain for your store. If have a domain registered elsewhere, you can point it to your fly.io app hostname by creating a certificate. The certificate window will instruct you what records to create

## Allowing multipart uploads direct to R2

Set CORS settings on bucket to point to your bazaar instance. This will speed up upload times. Defaults to uploading files through backend proxy
