// @effect-diagnostics nodeBuiltinImport:off - validates the supplied standalone engine without downloading release artifacts.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const execute = (binary: string, args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    const env = { ...process.env };
    delete env.KONTEXT_DIR;
    delete env.KONTEXT_CONFIG;
    NodeChildProcess.execFile(
      binary,
      args,
      { cwd, env, timeout: 15_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
  });

export const KONTEXT_RESOURCE_DIRECTORY = "kontext";
export const KONTEXT_REQUIRED_OPERATIONS = [
  "status",
  "setup",
  "entries.list",
  "entries.get",
  "entries.search",
  "entries.governing",
  "entries.export",
  "drafts.stage",
  "drafts.extract",
  "drafts.formalize",
  "guidance.propose",
  "operations.get",
] as const;

/** Run only host-compatible engines, in a throwaway checkout with no project data. */
export async function probeKontext(binary: string): Promise<void> {
  const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-kontext-probe-"));
  try {
    await execute("git", ["-c", "init.templateDir=", "init", "--quiet", scratch], scratch);
    const result = JSON.parse(
      await execute(binary, ["-C", scratch, "api", "status", "{}"], scratch),
    );
    if (
      result.schema_version !== 1 ||
      result.ok !== true ||
      result.result?.api_version !== 1 ||
      !Array.isArray(result.result.capabilities) ||
      KONTEXT_REQUIRED_OPERATIONS.some(
        (operation) => !result.result.capabilities.includes(operation),
      )
    )
      throw new Error("kontext machine API v1 with Peer's required operations is required");
  } finally {
    await NodeFSP.rm(scratch, { recursive: true, force: true });
  }
}

export interface KontextArtifactManifest {
  readonly api_version: 1;
  readonly sha256: string;
  readonly target: string;
}

/** A native artifact producer can ship this beside the exact binary for cross-platform packaging. */
export async function createKontextManifest(
  binary: string,
  target: string,
): Promise<KontextArtifactManifest> {
  await probeKontext(binary);
  return {
    api_version: 1,
    sha256: NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(binary))
      .digest("hex"),
    target,
  };
}

export async function stageKontextResource(input: {
  readonly binaryPath: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly resourcesDirectory: string;
  readonly platform: "mac" | "linux" | "win";
  readonly arch: string;
  readonly required: boolean;
  readonly hostPlatform: NodeJS.Platform;
  readonly hostArch: NodeJS.Architecture;
}): Promise<string | null> {
  if (!input.binaryPath) {
    if (input.required)
      throw new Error(
        "Peer desktop packaging requires T3CODE_KONTEXT_BIN pointing to a compatible standalone kontext engine",
      );
    return null;
  }
  const binary = await NodeFSP.realpath(input.binaryPath);
  if (!(await NodeFSP.stat(binary)).isFile())
    throw new Error("T3CODE_KONTEXT_BIN must name an executable file");
  if (input.arch === "universal") {
    if (input.platform !== "mac")
      throw new Error("A universal kontext resource is supported only for macOS");
    const bytes = await NodeFSP.readFile(binary);
    const magic = bytes.length >= 8 ? bytes.readUInt32BE(0) : 0;
    const little = magic === 0xbebafeca || magic === 0xbfbafeca;
    const fat = [0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic);
    const read = (offset: number) =>
      little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const count = fat ? read(4) : 0;
    const stride = magic === 0xcafebabf || magic === 0xbfbafeca ? 32 : 20;
    const architectures =
      count <= 16 && bytes.length >= 8 + count * stride
        ? Array.from({ length: count }, (_, index) => read(8 + index * stride))
        : [];
    if (!architectures.includes(0x01000007) || !architectures.includes(0x0100000c))
      throw new Error(
        "Universal Peer packaging requires a fat Mach-O kontext containing both x86_64 and arm64",
      );
  }
  const target = `${input.platform}-${input.arch}`;
  const native =
    (input.platform === "mac"
      ? input.hostPlatform === "darwin"
      : input.platform === "win"
        ? input.hostPlatform === "win32"
        : input.hostPlatform === "linux") &&
    (input.arch === input.hostArch || (input.platform === "mac" && input.arch === "universal"));
  if (native) await probeKontext(binary);
  else {
    if (!input.manifestPath)
      throw new Error(
        `Cross-platform kontext packaging for ${target} requires T3CODE_KONTEXT_MANIFEST from the artifact producer`,
      );
    const manifest = JSON.parse(
      await NodeFSP.readFile(input.manifestPath, "utf8"),
    ) as KontextArtifactManifest;
    const digest = NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(binary))
      .digest("hex");
    if (manifest.api_version !== 1 || manifest.target !== target || manifest.sha256 !== digest)
      throw new Error(
        "kontext artifact manifest must match API v1, the target and the supplied binary's SHA-256",
      );
  }
  const directory = NodePath.join(input.resourcesDirectory, KONTEXT_RESOURCE_DIRECTORY);
  await NodeFSP.mkdir(directory, { recursive: true });
  const destination = NodePath.join(
    directory,
    input.platform === "win" ? "kontext.exe" : "kontext",
  );
  await NodeFSP.copyFile(binary, destination);
  await NodeFSP.chmod(destination, 0o755);
  return destination;
}
