## Change and issue

<!-- Link the issue, describe the behavior change and mention any data/security implications. -->

Closes #

## Local-first QA

- [ ] Reviewed the diff, failure modes, security and tenant boundaries.
- [ ] Ran `npm run qa:local` **before** marking this PR ready (types, tests, Cloudflare bundle).
- [ ] Tested changed behavior and negative/error paths; no secrets or credentials in commits, logs, or examples.
- [ ] Batched related changes rather than pushing per-file commits.
- [ ] Described real integration gaps separately from mocked/local tests.

**Local result or limitation:** <!-- command result / why local execution was impossible -->

**External integration still unverified (if any):**

## Ready for review?

<!-- Keep as draft until local QA is done. Ready-for-review triggers CI; subsequent commits replace/cancel superseded PR runs. Merging triggers a separate main CI check. -->
