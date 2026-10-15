// @effect-diagnostics nodeBuiltinImport:off - tests isolated build resources and host-compatible executable probes.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  createKontextManifest,
  KONTEXT_REQUIRED_OPERATIONS,
  stageKontextResource,
} from "./kontext-resource.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { force: true, recursive: true })),
  );
});
const fixture = async (valid = true) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-engine-resource-"));
  roots.push(root);
  const binary = NodePath.join(root, "kontext");
  await NodeFSP.writeFile(
    binary,
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ schema_version: 1, ok: true, result: { api_version: valid ? 1 : 2, capabilities: KONTEXT_REQUIRED_OPERATIONS } }))});\n`,
    { mode: 0o755 },
  );
  return { root, binary, resources: NodePath.join(root, "resources") };
};
const nativePlatform = "linux";
const host = { hostPlatform: "linux", hostArch: "x64" } as const;

describe("packaging Peer's standalone kontext", () => {
  it("requires a supplied engine for Peer and leaves an optional upstream build alone", async () => {
    const input = {
      binaryPath: undefined,
      resourcesDirectory: "/unused",
      platform: nativePlatform,
      arch: "x64",
      ...host,
      required: true,
    } as const;
    await expect(stageKontextResource(input)).rejects.toThrow("T3CODE_KONTEXT_BIN");
    expect(await stageKontextResource({ ...input, required: false })).toBeNull();
  });
  it("probes a native binary in scratch Git and ships an executable outside app.asar", async () => {
    const test = await fixture();
    const result = await stageKontextResource({
      binaryPath: test.binary,
      resourcesDirectory: test.resources,
      platform: nativePlatform,
      arch: "x64",
      ...host,
      required: true,
    });
    expect(await NodeFSP.readFile(result!, "utf8")).toEqual(
      await NodeFSP.readFile(test.binary, "utf8"),
    );
    expect((await NodeFSP.stat(result!)).mode & 0o111).not.toBe(0);
    const invalid = await fixture(false);
    await expect(
      stageKontextResource({
        binaryPath: invalid.binary,
        resourcesDirectory: invalid.resources,
        platform: nativePlatform,
        arch: "x64",
        ...host,
        required: true,
      }),
    ).rejects.toThrow("machine API v1");
  });
  it("refuses a thin engine in an app advertised as universal", async () => {
    const test = await fixture();
    await expect(
      stageKontextResource({
        binaryPath: test.binary,
        resourcesDirectory: test.resources,
        platform: "mac",
        arch: "universal",
        required: true,
        hostPlatform: "darwin",
        hostArch: "arm64",
      }),
    ).rejects.toThrow("both x86_64 and arm64");
  });
  it("never executes a foreign target and verifies the producer's exact target and checksum", async () => {
    const test = await fixture();
    const foreignPlatform = "win";
    const target = `${foreignPlatform}-x64`;
    const manifest = await createKontextManifest(test.binary, target);
    const manifestPath = NodePath.join(test.root, "manifest.json");
    await NodeFSP.writeFile(manifestPath, JSON.stringify(manifest));
    const input = {
      binaryPath: test.binary,
      manifestPath,
      resourcesDirectory: test.resources,
      platform: foreignPlatform,
      arch: "x64",
      ...host,
      required: true,
    } as const;
    expect(await stageKontextResource(input)).toContain("kontext");
    await NodeFSP.writeFile(test.binary, "Different bytes");
    await expect(stageKontextResource(input)).rejects.toThrow("SHA-256");
    await expect(stageKontextResource({ ...input, manifestPath: undefined })).rejects.toThrow(
      "T3CODE_KONTEXT_MANIFEST",
    );
  });
});
