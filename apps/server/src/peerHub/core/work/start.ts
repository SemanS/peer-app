// @effect-diagnostics nodeBuiltinImport:off - where a task's own checkout goes under the workspace root.
/**
 * Starting an agent on a task (`peerHub.startAgent`). Core checks that the task is open, the
 * repository is the project's and the project lets people's own capacity in; creates the run and
 * launches the agent in a checkout of its own through the active task launcher (herdr's), in that run
 * (`launchInRun`), so the run alone puts the agent on the task; then reports it. Without the plugin a
 * step needs, it fails before anything happens, saying that plugin is turned off or needs a newer Hub.
 *
 * @module peerHub/core/work/start
 */
import * as NodePath from "node:path";

import {
  PeerHubError,
  type PeerHubStartAgentInput,
  type PeerHubStartAgentResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { isSafeGitRef } from "../../gitSafety.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { safeId } from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerWork from "./PeerWork.ts";
import * as PeerRuns from "./runs.ts";
import { launchInRun } from "./runs.ts";

const hubError = (detail: string) => new PeerHubError({ detail });

/** Starts an agent on a task in its own checkout, in a run on the task. */
export const startAgent = Effect.fn("PeerWork.startAgent")(function* (
  input: PeerHubStartAgentInput,
) {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const work = yield* PeerWork.PeerWork;
  const status = yield* PeerStatus.PeerStatus;
  const runs = yield* PeerRuns.PeerRuns;
  const refreshWork = work.refresh().pipe(state.lock.withPermits(1));

  yield* client.session;
  const { workspace, project } = yield* state.project(input.workspace, input.projectId);
  const task = (yield* work.tasks(workspace.slug, project.id)).find(
    (candidate) => candidate.id === input.taskId,
  );
  if (task === undefined || task.status === "done")
    return yield* hubError("Select an open task in this project first.");
  const repository = project.repositories.find((candidate) => candidate.id === input.repositoryId);
  if (repository === undefined || !safeId(repository.id))
    return yield* hubError("That repository does not belong to this project.");
  if (input.baseBranch !== undefined && !isSafeGitRef(input.baseBranch))
    return yield* hubError("That branch name is not a safe Git ref.");
  if (project.capacity.personal !== "any")
    return yield* hubError(
      "This project needs an approved commercial or shared provider. Start a Peer thread with an allowed provider instead.",
    );
  const launcher = yield* plugins.require("taskLauncher");
  const unavailable = yield* launcher.unavailable;
  if (unavailable !== null) return yield* hubError(unavailable);

  const fallback = `${task.key === undefined ? "" : `${task.key}: `}${task.title}. Work in your own checkout and coordinate shared changes through Peer.`;
  const checkout = state.checkoutPath(
    (yield* state.read).persisted,
    workspace.slug,
    project.id,
    repository.id,
  );
  const { started } = yield* launchInRun(
    runs,
    {
      workspace: workspace.slug,
      project: project.id,
      task: task.id,
      agent: input.harness,
      runtime: "herdr",
    },
    (env) =>
      launcher.launch({
        checkout,
        baseBranch: input.baseBranch ?? repository.branch,
        worktrees: NodePath.join(
          state.workspaceRoot,
          ".worktrees",
          workspace.slug,
          project.id,
          repository.id,
        ),
        task,
        harness: input.harness,
        prompt: input.prompt?.trim() ? input.prompt : fallback,
        env,
      }),
  );
  yield* refreshWork;
  yield* work.taskWorktreeCreated(
    {
      workspace: workspace.slug,
      project: project.id,
      repository: repository.id,
      task: task.id,
      thread: started.threadKey,
    },
    started.worktree,
  );
  yield* status.publish;
  return {
    paneId: started.paneId,
    terminalId: started.terminalId,
    ...(started.promptError === undefined ? {} : { promptError: started.promptError }),
  } satisfies PeerHubStartAgentResult;
});
