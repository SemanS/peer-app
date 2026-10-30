// @effect-diagnostics nodeBuiltinImport:off - whether a checkout exists here, and where a run's own checkout goes.
/**
 * Starting an agent for a delivery (design D6): a review session through the `reviewStarter` slot
 * for a person's own question, or a working run through `taskLauncher` for a message its owner
 * passed on. What cannot start fails with the words the room shows.
 *
 * @module peerHub/plugins/rooms/client/start
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  PeerHarness,
  PeerHubError,
  type PeerProject,
  type PeerRoomCapacity,
  type PeerRoomInboxItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerPlugins from "../../../core/plugins/PeerPlugins.ts";
import type * as PeerState from "../../../core/state/PeerState.ts";
import type * as PeerWork from "../../../core/work/PeerWork.ts";
import { NO_CHECKOUT } from "../follow.ts";
import { passedRunPrompt, reviewRoomPrompt, type Heard } from "../text.ts";

const isHarness = Schema.is(PeerHarness);
const refusal = (detail: string) => new PeerHubError({ detail, refused: true });
const isReview = (harness: string): harness is "claude" | "codex" =>
  harness === "claude" || harness === "codex";

/** The harness of a start: the one the message names, else the first the person declared, else Claude Code. */
const harnessOf = (item: PeerRoomInboxItem, me: string, project: PeerProject) =>
  item.message.to.find((target) => target.email === me)?.harness ??
  project.capacity.personalHarnesses.find(isReview) ??
  "claude";

/** The repository of the project this computer has a checkout of, first in the project's order. */
export const checkoutOf = (
  state: PeerState.PeerState["Service"],
  workspace: string,
  project: PeerProject,
) =>
  Effect.gen(function* () {
    const { persisted } = yield* state.read;
    for (const repository of project.repositories) {
      const path = state.checkoutPath(persisted, workspace, project.id, repository.id);
      const here = yield* Effect.promise(() =>
        NodeFSP.stat(path).then(
          (found) => found.isDirectory(),
          () => false,
        ),
      );
      if (here) return { repository, path };
    }
    return undefined;
  });

/** What carries a run: shared only where its Peer thread is on one of the project's shared instances. */
export function runCapacity(
  run: { readonly runtime: string; readonly thread?: string | undefined } | undefined,
  instances: ReadonlyArray<string>,
  threads: ReadonlyArray<{ readonly id: string; readonly providerInstanceId: string }>,
): PeerRoomCapacity {
  if (run?.runtime !== "peer" || run.thread === undefined) return "personal";
  const thread = threads.find((candidate) => `peer:${candidate.id}` === run.thread);
  return thread !== undefined && instances.includes(thread.providerInstanceId)
    ? "shared"
    : "personal";
}

export const roomStarts = (
  state: PeerState.PeerState["Service"],
  work: PeerWork.PeerWork["Service"],
  plugins: PeerPlugins.PeerPlugins["Service"],
) => {
  const placeOf = (workspace: string, item: PeerRoomInboxItem) =>
    Effect.gen(function* () {
      const { project } = yield* state.project(workspace, item.project);
      const task = (yield* work.tasks(workspace, item.project)).find(
        (candidate) => candidate.id === item.task,
      );
      if (task === undefined || task.status === "done")
        return yield* refusal("The task is closed, or Peer no longer knows it here.");
      const checkout = yield* checkoutOf(state, workspace, project);
      if (checkout === undefined) return yield* refusal(NO_CHECKOUT);
      return { project, task, checkout };
    });
  return {
    /** A session with role `review` on the person's capacity; the run it made. */
    review: (workspace: string, item: PeerRoomInboxItem, me: string, heard: Heard) =>
      Effect.gen(function* () {
        const { project, task, checkout } = yield* placeOf(workspace, item);
        const harness = harnessOf(item, me, project);
        if (!isReview(harness))
          return yield* refusal("Peer starts a review session with Claude Code or Codex only.");
        const starter = yield* plugins.require("reviewStarter");
        const started = yield* starter.start({
          workspace,
          projectId: project.id,
          taskId: task.id,
          repositoryId: checkout.repository.id,
          harness,
          prompt: reviewRoomPrompt(heard),
        });
        if (started.promptError !== undefined) return yield* refusal(started.promptError);
        return started.run ?? started.thread;
      }),
    /** A working run its owner's Pass on starts; the run it made. */
    work: (workspace: string, item: PeerRoomInboxItem, me: string, heard: Heard) =>
      Effect.gen(function* () {
        const { project, task, checkout } = yield* placeOf(workspace, item);
        const harness = harnessOf(item, me, project);
        if (!isHarness(harness)) return yield* refusal(`Peer cannot start ${harness} here.`);
        if (project.capacity.personal !== "any")
          return yield* refusal("This project needs an approved commercial or shared provider.");
        const launcher = yield* plugins.require("taskLauncher");
        const unavailable = yield* launcher.unavailable;
        if (unavailable !== null) return yield* refusal(unavailable);
        const { run, started } = yield* work.launchRun(
          { workspace, project: project.id, task: task.id, agent: harness, runtime: "herdr" },
          (env) =>
            launcher.launch({
              checkout: checkout.path,
              baseBranch: checkout.repository.branch,
              worktrees: NodePath.join(
                state.workspaceRoot,
                ".worktrees",
                workspace,
                project.id,
                checkout.repository.id,
              ),
              task,
              harness,
              prompt: passedRunPrompt(heard),
              env,
            }),
        );
        yield* work.refresh().pipe(state.lock.withPermits(1));
        if (started.promptError !== undefined) return yield* refusal(started.promptError);
        return run;
      }),
  };
};
