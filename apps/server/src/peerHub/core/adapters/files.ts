// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - atomic companion writes preserve configured native-home symlinks; agents' and editors' settings are JSON files.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

export async function writePreservingLink(file: string, contents: string): Promise<void> {
  const target = await NodeFSP.realpath(file).catch(async (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      const entry = await NodeFSP.lstat(file).catch((failure: unknown) => {
        if (
          typeof failure === "object" &&
          failure !== null &&
          "code" in failure &&
          failure.code === "ENOENT"
        )
          return undefined;
        throw failure;
      });
      if (entry?.isSymbolicLink())
        throw new Error(
          "The agent settings symlink target is missing; restore it before reviewing hooks.",
        );
      return file;
    }
    throw error;
  });
  await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
  const temporary = `${target}.peer-${NodeCrypto.randomUUID()}.tmp`;
  try {
    const mode = await NodeFSP.stat(target)
      .then((stat) => stat.mode & 0o777)
      .catch(() => 0o600);
    await NodeFSP.writeFile(temporary, contents, { mode });
    await NodeFSP.rename(temporary, target);
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
}

/** A JSON settings file: {} when it does not exist, null when it is not a JSON object. */
export async function readJsonSettings(path: string): Promise<Record<string, unknown> | null> {
  const text = await NodeFSP.readFile(path, "utf8").catch(() => null);
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Writes a JSON settings file in one step, keeping the original once as `<file>.peer-backup`. */
export async function writeJsonSettings(
  path: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  const backup = `${path}.peer-backup`;
  const existing = await NodeFSP.stat(path).then(
    () => true,
    () => false,
  );
  const backedUp = await NodeFSP.stat(backup).then(
    () => true,
    () => false,
  );
  if (existing && !backedUp) await NodeFSP.copyFile(path, backup);
  await writePreservingLink(path, `${JSON.stringify(settings, null, 2)}\n`);
}
