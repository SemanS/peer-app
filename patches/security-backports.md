# Security backports

The release uses patched registry versions where available. These local fixes keep the
remaining consumer APIs compatible and also cover code shipped inside compatibility exports.
They are applied through `patchedDependencies`; do not replace them with audit exclusions.

## RSA verification

The Expo toolchain uses the unchanged source archive of
[upstream PR 1160](https://github.com/digitalbazaar/forge/pull/1160), commit
`9842c3d3cf6f560270b4f42ab3c0c28c68e6f78e`, vendored in `vendor/` with a locked
integrity hash. Its genuine package identity is `node-forge@1.4.1-0`. The PR remains
unmerged; this is not an official published or maintainer-approved release.

The earlier PR 1152 element-count check was incomplete. Canonical DigestInfo
reconstruction also rejects nonempty NULL parameters and nonminimal BER lengths.
Regressions retain the public forged-signature vector and valid/wrong-message RSA
controls, plus structural controls for those encodings, extra children and valid
empty/absent parameters. Structural controls use exponent 1 to inspect the parser;
they are not presented as cryptographic forgeries.

All shared runtime files match registry 1.4.0 except `lib/rsa.js`; the manifest
changes only its upstream version and the README adds a security-policy link.
Generated browser bundles are absent from the source archive; Expo uses its
unchanged Node entry point. The archive has no runtime dependencies or new install
hooks. Its upstream prepublish build is not run. Local vendoring preserves the
package manager's block on exotic transitive sources and does not require an
exception or an audit exclusion. Provenance and checksum are in `vendor/README.md`.

## Bounded schema validation

Expo CLI and Vercel configuration now use the supported `zod/v3` entry point from
Zod 4.6.6. Their runtime imports and Expo declarations are patched together; scoped
overrides select that genuine package. The old Zod 3 package and its backport are
removed rather than renamed or assigned an invented version.

`zod@4.6.6.patch` remains necessary because this release's `/v3` compatibility
export still needs early array/set bounds. The regressions cover CommonJS and ES
modules, synchronous and asynchronous validation, root/v3/v4/mini exports, bounded
collections, refinement visits, valid transformations, actual Expo plugin/MCP
schemas and Vercel cron/static-field validation. Cursor resolves the same patched
package. The compatibility export retains the Zod 3 API; it does not invent size
limits for maps or records that have no such API.

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

The full native audit now reports no advisories, without exclusions or severity
filtering. Audits inspect package version metadata, not whether a particular
source revision contains a fix: an unpatched Forge prerelease control also passes
the version check, while a 1.4.0 local-archive control is reported as vulnerable.
The immutable source review and installed-consumer regressions therefore remain
part of the security evidence; zero reported advisories is not a source-code audit.

Desktop and CLI packaging select patches using the exact runtime dependency closure in the
root lockfile. A fresh staging install retains strict unused-patch checks, so a resolution
change must be reviewed rather than silently dropping a security fix.

Review these backports by 2026-11-01 and when updating their packages. Replace the Forge snapshot with a published release only after its canonical
DigestInfo verification passes the same regressions. Remove each compatibility
patch only after its replacement covers every used export and those regressions pass.
