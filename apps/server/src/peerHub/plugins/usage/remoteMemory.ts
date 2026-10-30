// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - a small local file, written atomically.
/**
 * What this computer has learned of its directories' `origin`, kept across restarts so that a
 * session stays in its project after its worktree is deleted. The origin and not the project:
 * matching against manifests stays fresh on every pass. It holds local paths, so it stays here.
 *
 * @module peerHub/plugins/usage/remoteMemory
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface RemoteFile {
  /** The file's text; null when there is none. */
  readonly read: () => Promise<string | null>;
  readonly write: (text: string) => Promise<void>;
}

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/** A file that cannot be understood teaches nothing, and is replaced by the next write. */
export const parseRemotes = (text: string | null): ReadonlyMap<string, string> =>
  new Map(Object.entries(Option.getOrElse(decode(text), () => ({}))));

/** Sorted, so that equal memories are equal text and an unchanged one is not written. */
export const printRemotes = (remotes: ReadonlyMap<string, string>) =>
  `${JSON.stringify(Object.fromEntries([...remotes].toSorted(([a], [b]) => a.localeCompare(b))))}\n`;

export const remoteFile = (path: string): RemoteFile => ({
  read: () => NodeFSP.readFile(path, "utf8").catch(() => null),
  write: async (text) => {
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
    try {
      await NodeFSP.writeFile(temporary, text, { mode: 0o600 });
      await NodeFSP.rename(temporary, path);
    } finally {
      await NodeFSP.rm(temporary, { force: true });
    }
  },
});

/** `lookup`, for a directory that is there: one that is gone costs no process. */
export const remoteWhenPresent =
  (lookup: (cwd: string) => Promise<string | null>) =>
  async (cwd: string): Promise<string | null> => {
    const present = await NodeFSP.stat(cwd).then(
      (stat) => stat.isDirectory(),
      () => false,
    );
    return present ? lookup(cwd) : null;
  };
