# Dependency advisory triage

Reviewed: 2026-10-15. This is a lockfile audit and local verification record, not a runtime exploitability test.

`npm audit --omit=dev --audit-level=high` reports **zero vulnerabilities**. The audit remediation upgrades Next/eslint-config-next to 16.4.1, Prisma and its adapters to 6.19.3, OpenNext to 1.20.11, and Wrangler to 4.151.0. Compatible dependency fixes and narrowly scoped overrides (`deepmerge-ts` 8.0.2 and the minifier's `glob` 10.5.0) remove the earlier production Next and Prisma-chain findings. The generated Prisma client matches the schema and installed version.

The full development graph reports five high-severity package entries, all for one remaining [braces stack-exhaustion advisory, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):

| Installed path | Exposure and disposition |
| --- | --- |
| `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3` | Development lint tooling. Deeply nested glob patterns can exhaust the stack. No compatible fixed braces version was available at this review; npm's automatic force fix would downgrade eslint-config-next to 14.2.35, mismatching Next 16.4.1. Keep this open and review upstream rather than applying that downgrade. |

Boatship's checked-in lint command uses fixed paths, and request handlers do not import this chain. That bounds the apparent request exposure without declaring the toolchain immune to untrusted patterns. The five audit entries are propagation through that single dependency chain, not five separate underlying vulnerabilities.

CI now checks production dependencies at high severity, alongside unit/HTTP integration tests, typecheck, lint, and build. Weekly Dependabot proposals continue to surface updates. Re-run the full audit when upstream publishes a compatible fix, and validate lint, Next/OpenNext packaging, and Wrangler dry run after any toolchain change. The remaining development advisory is not suppressed from the audit output.
