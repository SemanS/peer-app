// @effect-diagnostics nodeBuiltinImport:off - atomic companion writes preserve configured native-home symlinks.
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
          "The Codex settings symlink target is missing; restore it before reviewing hooks.",
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
