# Security backports

The release uses patched registry versions where available. These local fixes keep the
remaining consumer APIs compatible and also cover code shipped inside compatibility exports.
They are applied through `patchedDependencies`; do not replace them with audit exclusions.

## RSA verification

`node-forge@1.4.0.patch` backports the nested DigestAlgorithm element-count check from
[upstream PR 1152](https://github.com/digitalbazaar/forge/pull/1152), head
`ceba34402e329f0365134f23fe19898756527d65`, for
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
There is no published 1.4.1 package. The regression uses the public forged-signature vector
and also checks valid signatures and wrong-message rejection.

## Bounded schema validation

`zod@3.25.76.patch` preserves the Zod 3 API used by Expo and Vercel while rejecting oversized
bounded arrays and sets before copying or validating their elements. It also adapts the
[upstream collection-bound fix](https://github.com/colinhacks/zod/commit/a0ebf97) to the old
Zod 4 core bundled in that package, including classic and mini exports.

`zod@4.6.6.patch` repairs that release's still-vulnerable `/v3` compatibility export. Updating
only the package version would leave the compatibility implementation exposed. Cursor SDK
1.0.40 externalizes its schemas and resolves this patched version, replacing the older SDK's
embedded copy. The patches retain existing check ordering and valid-input behavior.

The regressions cover CommonJS and ES modules, synchronous and asynchronous validation,
bounded arrays/sets/maps, refinement visits, valid transformations and consumer schemas.
Zod 3 maps and records have no size-limit API; these patches do not invent global limits.

## Cache revalidation

`http-cache-semantics@4.3.0.patch` is a downstream strict revalidation policy. The published
4.3.0 update does not change the disputed
[max-stale report](https://github.com/kornelski/http-cache-semantics/issues/56).
Entries forbidden for shared reuse or requiring origin validation cannot be revived through
max-stale, background revalidation or stale-if-error. Tests preserve ordinary expiry and
explicit public/private-cache behavior.

## Verification and removal

Run the consumer-resolved regressions with:

```sh
vp test run scripts/security-parser-dependencies.test.ts scripts/security-schema-dependencies.test.ts
pnpm audit --json
```

The native audit reports versions, not the applied source patches. It therefore continues
to report node-forge 1.4.0 and Zod 3.25.76. Preserve that raw result with release evidence;
a successful regression suite does not make the raw audit a zero-finding result.

Desktop and CLI packaging select patches using the exact runtime dependency closure in the
root lockfile. A fresh staging install retains strict unused-patch checks, so a resolution
change must be reviewed rather than silently dropping a security fix.

Review these backports by 2026-11-01 and when updating their packages. Remove each only after
the replacement covers every used compatibility export and the regressions still pass.
