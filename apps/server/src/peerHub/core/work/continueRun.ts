// @effect-diagnostics nodeBuiltinImport:off - where a task's own checkout goes under the workspace root.
/**
 * Continuing a detached run (`peerHub.continueRun`, design D6): a new session in the run, on the
 * Peer that minted it. A Peer thread's run wakes its thread as a teammate's news would; a herdr
 * run starts again through the task launcher with the run's identity; a terminal run continues in
 * the terminal, where its person runs it.
 *
 * @module peerHub/core/work/continueRun
 */
import * as NodePath from "node:path";

import {
  PeerHarness,
  type PeerHubContinueRunInput,
  type PeerHubContinueRunResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as PeerCoordination from "../coordination/PeerCoordination.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerWork from "./PeerWork.ts";
import * as PeerRuns from "./runs.ts";
import { stateOf } from "./runs.ts";

const isHarness = Schema.is(PeerHarness);
const notStarted = (reason: string): PeerHubContinueRunResult => ({ started: false, reason });

export const continueRun = Effect.fn("PeerRuns.continueRun")(function* (
  input: PeerHubContinueRunInput,
) {
  const runs = yield* PeerRuns.PeerRuns;
  const run = runs.book.get(input.runId);
  if (run === undefined || run.workspace !== input.workspace || run.project !== input.projectId)
    return notStarted("This run was started on another computer; continue it there.");
  const state = stateOf(run);
  if (state !== "detached")
    return notStarted(state === "ended" ? "This run has ended." : "This run is running now.");
  switch (run.runtime) {
    case "terminal":
      return notStarted(`continue it with peer core runs continue ${run.id}`);
    case "mcp":
      return notStarted("Continue it from the editor it ran in.");
    case "peer": {
      const broker = (yield* PeerCoordination.PeerCoordination).broker();
      const last = run.sessions.at(-1);
      if (broker?.host.queueNative === undefined || run.thread === undefined || last === undefined)
        return notStarted("Peer cannot wake this run's thread here now.");
      const queueNative = broker.host.queueNative;
      const thread = run.thread;
      const queued = yield* Effect.promise(() =>
        queueNative(
          last.id,
          `Peer: your person continues run ${run.id}. Pick the task up where the run left it.`,
          thread,
        ).catch(() => false),
      );
      return queued ? { started: true } : notStarted("Peer could not wake this thread's agent.");
    }
    case "herdr": {
      if (!isHarness(run.agent)) return notStarted(`herdr cannot start ${run.agent} again.`);
      const harness = run.agent;
      const peerState = yield* PeerState.PeerState;
      const launcher = yield* (yield* PeerPlugins.PeerPlugins).require("taskLauncher");
      const unavailable = yield* launcher.unavailable;
      if (unavailable !== null) return notStarted(unavailable);
      const { workspace, project } = yield* peerState.project(run.workspace, run.project);
      const task = (yield* (yield* PeerWork.PeerWork).tasks(workspace.slug, project.id)).find(
        (candidate) => candidate.id === run.task,
      );
      const repository = project.repositories[0];
      if (task === undefined || repository === undefined)
        return notStarted("Peer no longer knows this run's task here.");
      const identity = yield* Effect.promise(() => runs.book.continueEnv(run.id));
      if (identity === undefined) return notStarted("This run can no longer be continued.");
      const started = yield* launcher.launch({
        checkout: peerState.checkoutPath(
          (yield* peerState.read).persisted,
          workspace.slug,
          project.id,
          repository.id,
        ),
        baseBranch: repository.branch,
        worktrees: NodePath.join(
          peerState.workspaceRoot,
          ".worktrees",
          workspace.slug,
          project.id,
          repository.id,
        ),
        task,
        harness,
        prompt: `${task.key === undefined ? "" : `${task.key}: `}${task.title}. You continue run ${run.id} on this task; read your working context and the task's shared context before you change anything.`,
        env: identity.env,
      });
      yield* Effect.promise(() =>
        runs.book.hold(run.id, started.threadKey, started.paneId).catch(() => undefined),
      );
      return { started: true };
    }
  }
});
