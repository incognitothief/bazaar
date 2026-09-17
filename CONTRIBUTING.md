# Contributing to Bazaar

Thanks for considering a contribution. Bazaar is in **alpha** and under active rewrite —
lexicons, schema and deploy tooling all still move. Open an issue before starting anything
substantial, so you don't build on a piece that's about to change.

## Licence and the CLA

Bazaar is licensed in two parts:

- **The application** is **AGPL-3.0-only** (see [LICENSE](LICENSE)).
- **The lexicons** in `packages/shared/src/lexicons/*.json` are **Apache-2.0**, so anyone
  can implement Bazaar's record format without AGPL obligations. See
  [that directory's README](packages/shared/src/lexicons/README.md).

Check which side of that line your change falls on — contributions to the lexicon JSON are
contributions to an Apache-2.0 licensed schema.

Before your first pull request can be merged, you'll be asked to sign the
[Contributor License Agreement](CLA.md). A bot comments on your PR with a link; signing
takes a few seconds and is a one-off — every later PR is automatic.

**What it means, briefly.** You keep the copyright in your work. You grant the maintainer a
broad licence that includes the right to sublicense, which allows Bazaar to be offered under
AGPL and, where appropriate, under commercial terms for users who can't accept AGPL
obligations. You stay free to use and relicense your own contribution however you like.

**What you get in return.** Section 6 of the CLA commits the maintainer to keeping your
contribution available under AGPL. If Bazaar is ever relicensed commercially or taken
proprietary, that doesn't claw your work back from the public — the AGPL rights people
already hold in it stand.

**Disclose your sources.** If a contribution contains third-party material, or came out of
a generative tool that may have reproduced someone else's code, say so in the PR. The CLA
only covers material you actually hold rights in, and using an automated tool doesn't
change that obligation.

If that trade isn't one you want to make, that's a legitimate position — please still file
issues and bug reports, which need no agreement at all.

## Getting set up

```bash
npm ci
npm run build
npm run test -w @bazaar/server
```

`README.md` covers the deployment side: R2, Fly, storefront identity and OAuth. You don't
need any of it to run tests or work on the client.

## Before you open a PR

CI runs lexicon validation, a full workspace build and the server unit tests — the same three
commands above. Run them locally first; `test` is a required status check and a red build
blocks the merge.

- Match the surrounding code. The repo has settled conventions; follow the file you're in.
- Keep changes focused. One concern per PR.
- Update `docs/adr/` if you're changing an architectural decision. The ADRs are the project's
  memory and they're kept current.
- Don't commit secrets. `.env*` is gitignored except `.env.example`. Push protection is on.

## Architecture decisions

Significant design changes are recorded as ADRs in `docs/adr/`. Read the relevant ones before
proposing a change to lexicons, identity resolution or the deploy pipeline — several current
behaviours are deliberate and documented there, including some that look like bugs.

## Reporting security issues

Please don't open a public issue for a vulnerability. Report it privately through
[GitHub Security Advisories](https://github.com/incognitothief/bazaar/security/advisories/new).
