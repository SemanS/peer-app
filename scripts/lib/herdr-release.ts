// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - The herdr fetch runs as a plain build step before any Effect runtime and verifies downloads with Node's crypto.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as Schema from "effect/Schema";

import pin from "../herdr-release.json" with { type: "json" };

export const HERDR_ASSET_KEYS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const;
export type HerdrAssetKey = (typeof HERDR_ASSET_KEYS)[number];

export interface HerdrAsset {
  readonly name: string;
  readonly sha256: string;
}

export interface HerdrRelease {
  readonly version: string;
  readonly protocol: number;
  readonly assets: Readonly<Record<HerdrAssetKey, HerdrAsset>>;
  readonly urlBase: string;
}

export const HERDR_RELEASE: HerdrRelease = pin satisfies HerdrRelease;

export const DEFAULT_HERDR_REPO_ROOT = NodePath.dirname(
  NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
);

export class HerdrChecksumMismatchError extends Schema.TaggedError<HerdrChecksumMismatchError>()(
  "HerdrChecksumMismatchError",
  {
    assetName: Schema.String,
    expectedSha256: Schema.String,
    actualSha256: Schema.String,
  },
) {
  override get message(): string {
    return `herdr asset ${this.assetName} does not match its pinned SHA-256 (expected ${this.expectedSha256}, got ${this.actualSha256}). Refusing to use it; scripts/herdr-release.json is the pin.`;
  }
}

export class HerdrDownloadError extends Schema.TaggedError<HerdrDownloadError>()(
  "HerdrDownloadError",
  {
    assetName: Schema.String,
    url: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Could not download herdr asset ${this.assetName} from ${this.url}: ${this.reason}`;
  }
}

export class HerdrUnsupportedTargetError extends Schema.TaggedError<HerdrUnsupportedTargetError>()(
  "HerdrUnsupportedTargetError",
  {
    platform: Schema.String,
    arch: Schema.String,
  },
) {
  override get message(): string {
    return `Peer bundles herdr only for macOS and Linux on x64 or arm64, not ${this.platform}-${this.arch}.`;
  }
}

/** Maps a Node platform and arch to the pin's asset key, or undefined when none is shipped. */
export function herdrAssetKey(platform: string, arch: string): HerdrAssetKey | undefined {
  const key = `${platform}-${arch}`;
  return HERDR_ASSET_KEYS.find((candidate) => candidate === key);
}

export function requireHerdrAssetKey(platform: string, arch: string): HerdrAssetKey {
  const key = herdrAssetKey(platform, arch);
  if (!key) throw new HerdrUnsupportedTargetError({ platform, arch });
  return key;
}

export function herdrCacheDirectory(repoRoot: string, release: HerdrRelease): string {
  return NodePath.join(repoRoot, ".cache", "herdr", release.version);
}

export function herdrCachedAssetPath(
  repoRoot: string,
  release: HerdrRelease,
  key: HerdrAssetKey,
): string {
  return NodePath.join(herdrCacheDirectory(repoRoot, release), release.assets[key].name);
}

export function sha256Hex(bytes: Uint8Array): string {
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}

export type HerdrFetch = (url: string) => Promise<Response>;

export interface FetchHerdrAssetInput {
  readonly key: HerdrAssetKey;
  readonly repoRoot?: string | undefined;
  readonly release?: HerdrRelease | undefined;
  readonly fetch?: HerdrFetch | undefined;
}

export interface FetchedHerdrAsset {
  readonly path: string;
  readonly downloaded: boolean;
}

async function readIfPresent(filePath: string): Promise<Uint8Array | undefined> {
  try {
    return await NodeFS.readFile(filePath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

/**
 * Returns the cached asset when it still matches the pin, and otherwise downloads
 * it. Bytes are verified before they reach the cache path, so a mismatch never
 * leaves a file that a later run would trust.
 */
export async function fetchHerdrAsset(input: FetchHerdrAssetInput): Promise<FetchedHerdrAsset> {
  const release = input.release ?? HERDR_RELEASE;
  const repoRoot = input.repoRoot ?? DEFAULT_HERDR_REPO_ROOT;
  const doFetch: HerdrFetch = input.fetch ?? ((url) => fetch(url));
  const asset = release.assets[input.key];
  const destination = herdrCachedAssetPath(repoRoot, release, input.key);

  const cached = await readIfPresent(destination);
  if (cached && sha256Hex(cached) === asset.sha256) {
    await NodeFS.chmod(destination, 0o755);
    return { path: destination, downloaded: false };
  }

  const url = new URL(asset.name, release.urlBase).toString();
  const response = await doFetch(url).catch((cause: unknown) => {
    throw new HerdrDownloadError({
      assetName: asset.name,
      url,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  });
  if (!response.ok) {
    throw new HerdrDownloadError({
      assetName: asset.name,
      url,
      reason: `HTTP ${response.status}`,
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256Hex(bytes);
  if (actual !== asset.sha256) {
    throw new HerdrChecksumMismatchError({
      assetName: asset.name,
      expectedSha256: asset.sha256,
      actualSha256: actual,
    });
  }

  await NodeFS.mkdir(NodePath.dirname(destination), { recursive: true });
  const partial = `${destination}.${process.pid}.part`;
  await NodeFS.writeFile(partial, bytes, { mode: 0o755 });
  await NodeFS.rename(partial, destination);
  await NodeFS.chmod(destination, 0o755);
  return { path: destination, downloaded: true };
}
