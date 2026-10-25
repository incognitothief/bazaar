# Contributing to Bazaar

Thanks for considering a contribution. Bazaar is in **alpha** and under active rewrite —
lexicons, schema and deploy tooling all still move. Open an issue before starting anything
substantial, so you don't build on a piece that's about to change.

## Licence

Bazaar is **MIT** licensed (see [LICENSE](LICENSE)), lexicons included. By opening a pull
request you agree that your contribution is licensed under those same terms. There is no
separate agreement to sign.

**Disclose your sources.** If a contribution contains third-party material, or came out of
a generative tool that may have reproduced someone else's code, say so in the PR. You can
only license material you actually hold rights in, and using an automated tool doesn't
change that.

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
