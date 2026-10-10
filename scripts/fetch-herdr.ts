#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Development CLI that prints to the terminal outside an Effect runtime.
import {
  HERDR_ASSET_KEYS,
  HERDR_RELEASE,
  fetchHerdrAsset,
  requireHerdrAssetKey,
  type HerdrAssetKey,
} from "./lib/herdr-release.ts";

// Fetches the pinned herdr release binary for this computer into .cache/herdr/<version>/
// (`--all` fetches every platform). The desktop app picks it up in development.
async function main(argv: ReadonlyArray<string>): Promise<void> {
  const keys: ReadonlyArray<HerdrAssetKey> = argv.includes("--all")
    ? HERDR_ASSET_KEYS
    : [requireHerdrAssetKey(process.platform, process.arch)];
  for (const key of keys) {
    const { path, downloaded } = await fetchHerdrAsset({ key });
    console.log(
      `herdr ${HERDR_RELEASE.version} ${key}: ${downloaded ? "downloaded" : "already cached"} ${path}`,
    );
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
