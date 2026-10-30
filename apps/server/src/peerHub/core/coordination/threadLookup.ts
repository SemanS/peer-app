/**
 * Which Peer thread an agent's session belongs to, and which agent a Peer thread runs: lookups the
 * broker's host makes in T3's projections, apart from the service that builds the host.
 *
 * @module peerHub/core/coordination/threadLookup
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import type * as ProjectService from "../../../project/ProjectService.ts";
import { harnessForDriver } from "../../hubPolicy.ts";

/**
 * The Peer thread whose agent runs as a provider session, by the session id its harness gives
 * hooks: Peer starts Claude Code with its thread's native id, and Codex's thread id is it too.
 * Threads at work come first, since a session's hooks start as its thread's turn does.
 */
export const threadOfNative = (
  projections: ProjectionStore.ProjectionStoreV2["Service"],
  nativeId: string,
) =>
  Effect.gen(function* () {
    const shell = yield* projections.getShellSnapshot({ location: "active" });
    // Only threads at work, or whose run started lately: a session's hooks start with its run.
    const lately = DateTime.toEpochMillis(yield* DateTime.now) - 15 * 60 * 1000;
    const candidates = shell.threads
      .filter(
        (thread) =>
          (thread.activityRunStatus ?? null) !== null ||
          (thread.latestRunStartedAt !== undefined &&
            thread.latestRunStartedAt !== null &&
            DateTime.toEpochMillis(thread.latestRunStartedAt) > lately),
      )
      .slice(0, 20);
    for (const thread of candidates) {
      const records = yield* projections.getThreadRecords(thread.id, ["providerThreads"]);
      if (records.providerThreads.some((p) => p.nativeThreadRef?.nativeId === nativeId)) {
        return `peer:${thread.id}`;
      }
    }
    return undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));

/** The agent a Peer thread (`peer:<id>`) runs now, the folder it runs in and its native session. */
export const threadAgentOf = (
  projections: ProjectionStore.ProjectionStoreV2["Service"],
  projects: ProjectService.ProjectService["Service"],
  key: string,
) =>
  Effect.gen(function* () {
    const id = key.replace(/^peer:/, "");
    const shell = yield* projections.getShellSnapshot({ location: "active" });
    const thread = shell.threads.find((thread) => thread.id === id);
    if (thread === undefined) return null;
    const records = yield* projections.getThreadRecords(thread.id, ["providerThreads"]);
    const provider = records.providerThreads.find(
      (provider) => provider.id === thread.activeProviderThreadId,
    );
    const agent = provider === undefined ? undefined : harnessForDriver(provider.driver);
    const project = yield* projects.getById(thread.projectId);
    if (agent === undefined || Option.isNone(project)) return null;
    return {
      agent,
      cwd: thread.worktreePath ?? project.value.workspaceRoot,
      ...(provider?.nativeThreadRef?.nativeId == null
        ? {}
        : { nativeId: provider.nativeThreadRef.nativeId }),
    };
  }).pipe(Effect.orElseSucceed(() => null));
