// @effect-diagnostics nodeBuiltinImport:off - opt-in creation uses trusted launcher provenance.
import * as Effect from "effect/Effect";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { PeerLifecycleEvent } from "../../../core/plugin.ts";
import { commandPath } from "../../../core/local.ts";
import { runProcess, type Runner } from "./process.ts";
export type Created = Extract<PeerLifecycleEvent, { kind: "task-worktree-created" }>;
/** Never initialize an existing index, a moved/replaced directory or a no-longer-assigned task. */
export async function indexCreated(
  event: Created,
  parent: string,
  valid: () => boolean,
  run: Runner = runProcess,
  binary = process.env.PEER_CODEGRAPH_BIN ?? commandPath("codegraph"),
  signal?: AbortSignal,
) {
  if (!binary || !valid()) return false;
  try {
    const root = await NodeFSP.realpath(event.root),
      base = await NodeFSP.realpath(parent),
      stat = await NodeFSP.lstat(event.root);
    if (
      root !== event.root ||
      !root.startsWith(base + NodePath.sep) ||
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      `${stat.dev}:${stat.ino}` !== event.identity
    )
      return false;
    const git = await NodeFSP.lstat(NodePath.join(root, ".git"));
    if (!git.isFile()) return false;
    try {
      await NodeFSP.lstat(NodePath.join(root, ".codegraph"));
      return false;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return false;
    }
    if (!valid()) return false;
    await run(binary, ["init", root], root, { timeoutMs: 30_000, cap: 1024 * 1024, signal });
    return true;
  } catch {
    return false;
  }
}

/** Cancellation owns only this index process, including disable while a check is in flight. */
export function createIndexer(index: typeof indexCreated = indexCreated) {
  let job: { workspace: string; controller: AbortController } | undefined;
  return {
    abort: (workspace?: string) => {
      if (!workspace || job?.workspace === workspace) job?.controller.abort();
    },
    run: (event: Created, parent: string, valid: () => boolean) => {
      const work = Effect.tryPromise(async (signal) => {
        const controller = new AbortController();
        job = { workspace: event.workspace, controller };
        try {
          return await index(
            event,
            parent,
            valid,
            undefined,
            undefined,
            AbortSignal.any([signal, controller.signal]),
          );
        } finally {
          if (job?.controller === controller) job = undefined;
        }
      });
      return Effect.raceFirst(
        work,
        Effect.gen(function* () {
          while (valid()) yield* Effect.sleep(1000);
        }),
      ).pipe(Effect.ignore);
    },
  };
}
