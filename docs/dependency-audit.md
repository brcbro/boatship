# Dependency advisory triage

Reviewed: 2026-09-25. This is a lockfile review, not a runtime exploitability test.

`npm audit --omit=dev` reports four high-severity package entries and no critical entries. The four entries describe two underlying advisories in the same dependency chain:

| Advisory | Installed path | What the report says | Current disposition |
| --- | --- | --- | --- |
| [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `prisma@6.16.2` → `@prisma/config@6.16.2` → `deepmerge-ts@7.1.5` | Recursive object graphs can exhaust the stack during merge. | Open. No compatible package update is offered by `npm audit`. |
| [GHSA-38f7-945m-qr2g](https://github.com/advisories/GHSA-38f7-945m-qr2g) | `prisma@6.16.2` → `@prisma/config@6.16.2` → `effect@3.16.12` | Concurrent RPC work can lose or contaminate `AsyncLocalStorage` context. | Open. No compatible package update is offered by `npm audit`. |

`@prisma/config` is used through Prisma tooling and the generated-client setup; this review found no direct import of these two vulnerable packages from Boatship request handlers. That reduces apparent request-path exposure, but it does not establish that the advisories are unreachable during builds, migrations, or deployment. Prisma is also a peer of `@prisma/client`, so it appears in the production audit graph.

The audit's automatic fix proposes `npm audit fix --force`, which would install `prisma@6.12.0` and change the current Prisma toolchain. We did not make that downgrade without validating schema generation, migrations, and the Cloudflare build. Weekly Dependabot pull requests and a CI critical-severity audit gate now surface new findings. Review these advisories on each Prisma update, test a supported fixed release when available, and tighten the gate to high severity once this baseline is resolved.
