// @effect-diagnostics nodeBuiltinImport:off - Tests use temporary directories and Node's crypto to build fake herdr assets.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";

import {
  HERDR_ASSET_KEYS,
  HERDR_RELEASE,
  HerdrChecksumMismatchError,
  HerdrDownloadError,
  fetchHerdrAsset,
  herdrAssetKey,
  herdrCachedAssetPath,
  requireHerdrAssetKey,
  sha256Hex,
  type HerdrFetch,
  type HerdrRelease,
} from "./herdr-release.ts";

const payload = new TextEncoder().encode("fake herdr binary");
const release: HerdrRelease = {
  ...HERDR_RELEASE,
  assets: {
    ...HERDR_RELEASE.assets,
    "darwin-arm64": { name: "herdr-macos-aarch64", sha256: sha256Hex(payload) },
  },
};

describe("herdr-release", () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-herdr-release-"));
  });
  afterEach(async () => {
    await NodeFSP.rm(repoRoot, { recursive: true, force: true });
  });

  const fetchOf = (body: Uint8Array, requested: string[] = []): HerdrFetch => {
    return async (url) => {
      requested.push(url);
      return new Response(Uint8Array.from(body));
    };
  };

  it("pins four assets with 64-character SHA-256 hashes under the release tag", () => {
    assert.deepStrictEqual(Object.keys(HERDR_RELEASE.assets), [...HERDR_ASSET_KEYS]);
    for (const asset of Object.values(HERDR_RELEASE.assets)) {
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    }
    assert.equal(
      HERDR_RELEASE.urlBase,
      `https://github.com/herdrdev/herdr/releases/download/v${HERDR_RELEASE.version}/`,
    );
  });

  it("maps only macOS and Linux on x64 and arm64 to assets", () => {
    assert.equal(herdrAssetKey("darwin", "arm64"), "darwin-arm64");
    assert.equal(herdrAssetKey("linux", "x64"), "linux-x64");
    assert.isUndefined(herdrAssetKey("win32", "x64"));
    assert.isUndefined(herdrAssetKey("linux", "ia32"));
    assert.throws(() => requireHerdrAssetKey("win32", "x64"), /macOS and Linux/);
  });

  it("downloads an asset whose hash matches and caches it executable", async () => {
    const requested: string[] = [];
    const result = await fetchHerdrAsset({
      key: "darwin-arm64",
      repoRoot,
      release,
      fetch: fetchOf(payload, requested),
    });

    assert.equal(result.downloaded, true);
    assert.equal(result.path, herdrCachedAssetPath(repoRoot, release, "darwin-arm64"));
    assert.equal(
      result.path,
      NodePath.join(repoRoot, ".cache", "herdr", release.version, "herdr-macos-aarch64"),
    );
    assert.deepStrictEqual(requested, [`${release.urlBase}herdr-macos-aarch64`]);
    assert.equal(sha256Hex(await NodeFSP.readFile(result.path)), sha256Hex(payload));
    assert.equal((await NodeFSP.stat(result.path)).mode & 0o777, 0o755);
  });

  it("refuses a mismatching download naming the asset and both hashes, and caches nothing", async () => {
    const wrong = new TextEncoder().encode("tampered");
    const error = await fetchHerdrAsset({
      key: "darwin-arm64",
      repoRoot,
      release,
      fetch: fetchOf(wrong),
    }).catch((cause: unknown) => cause);

    assert.instanceOf(error, HerdrChecksumMismatchError);
    const message = (error as HerdrChecksumMismatchError).message;
    assert.include(message, "herdr-macos-aarch64");
    assert.include(message, sha256Hex(payload));
    assert.include(message, sha256Hex(wrong));
    const cacheDirectory = NodePath.dirname(
      herdrCachedAssetPath(repoRoot, release, "darwin-arm64"),
    );
    const leftovers = await NodeFSP.readdir(cacheDirectory).catch(() => []);
    assert.deepStrictEqual(leftovers, []);
  });

  it("reuses a verified cached asset without downloading", async () => {
    const destination = herdrCachedAssetPath(repoRoot, release, "darwin-arm64");
    await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
    await NodeFSP.writeFile(destination, payload);

    const result = await fetchHerdrAsset({
      key: "darwin-arm64",
      repoRoot,
      release,
      fetch: async () => {
        throw new Error("must not download");
      },
    });

    assert.deepStrictEqual(result, { path: destination, downloaded: false });
    assert.equal((await NodeFSP.stat(destination)).mode & 0o777, 0o755);
  });

  it("replaces a cached asset that no longer matches the pin", async () => {
    const destination = herdrCachedAssetPath(repoRoot, release, "darwin-arm64");
    await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
    await NodeFSP.writeFile(destination, "corrupt");

    const result = await fetchHerdrAsset({
      key: "darwin-arm64",
      repoRoot,
      release,
      fetch: fetchOf(payload),
    });

    assert.equal(result.downloaded, true);
    assert.equal(sha256Hex(await NodeFSP.readFile(destination)), sha256Hex(payload));
  });

  it("reports HTTP and network failures as download errors", async () => {
    const httpError = await fetchHerdrAsset({
      key: "darwin-arm64",
      repoRoot,
      release,
      fetch: async () => new Response("nope", { status: 404 }),
    }).catch((cause: unknown) => cause);
    assert.instanceOf(httpError, HerdrDownloadError);
    assert.include((httpError as HerdrDownloadError).message, "HTTP 404");

    const networkError = await fetchHerdrAsset({
      key: "darwin-arm64",
      repoRoot,
      release,
      fetch: async () => {
        throw new Error("offline");
      },
    }).catch((cause: unknown) => cause);
    assert.instanceOf(networkError, HerdrDownloadError);
    assert.include((networkError as HerdrDownloadError).message, "offline");
  });
});
