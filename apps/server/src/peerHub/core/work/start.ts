// @effect-diagnostics nodeBuiltinImport:off - where a task's own checkout goes under the workspace root.
/**
 * Starting an agent on a task (`peerHub.startAgent`). Core checks that the task is open, the
 * repository is the project's and the project lets people's own capacity in; takes the team
 * request the start answers through the active request acceptor (team requests'); launches the
 * agent in a checkout of its own through the active task launcher (herdr's); then puts the agent's
 * thread on the task and reports it. Without the plugin a step needs, it fails before anything
 * happens, saying that plugin is turned off or needs a newer Hub.
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

const hubError = (detail: string) => new PeerHubError({ detail });

/** Starts an agent on a task in its own checkout and puts its thread on the task. */
export const startAgent = Effect.fn("PeerWork.startAgent")(function* (
  input: PeerHubStartAgentInput,
) {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const work = yield* PeerWork.PeerWork;
  const status = yield* PeerStatus.PeerStatus;
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
  // Starting from a team request needs team requests, which say whether it still waits.
  const acceptor =
    input.requestId === undefined ? undefined : yield* plugins.require("requestAcceptor");
  const launcher = yield* plugins.require("taskLauncher");
  const unavailable = yield* launcher.unavailable;
  if (unavailable !== null) return yield* hubError(unavailable);

  let requestedPrompt: string | undefined;
  const fallback = `${task.key === undefined ? "" : `${task.key}: `}${task.title}. Work in your own checkout and coordinate shared changes through Peer.`;
  if (acceptor !== undefined && input.requestId !== undefined) {
    requestedPrompt = (yield* acceptor.accept({
      workspace: workspace.slug,
      project: project.id,
      task: task.id,
      requestId: input.requestId,
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
      fallback,
    })).prompt;
    // Publish the accepted ownership even if runtime startup later fails.
    yield* refreshWork;
    yield* status.publish;
  }
  const started = yield* launcher
    .launch({
      checkout: state.checkoutPath(
        (yield* state.read).persisted,
        workspace.slug,
        project.id,
        repository.id,
      ),
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
      prompt: requestedPrompt ?? (input.prompt?.trim() || fallback),
      env: {
        PEER_TASK: task.key ?? task.id,
      },
    })
    .pipe(
      Effect.mapError((failure) =>
        input.requestId === undefined
          ? failure
          : hubError(
              `${failure.detail} The request is accepted. Inspect herdr and the task before starting another agent.`,
            ),
      ),
    );
  yield* work.assign(started.threadKey, {
    workspace: workspace.slug,
    project: project.id,
    task: task.id,
  });
  yield* refreshWork;
  if (started.worktree !== undefined) {
    const created = started.worktree,
      parent = NodePath.join(
        state.workspaceRoot,
        ".worktrees",
        workspace.slug,
        project.id,
        repository.id,
      ),
      relative = NodePath.relative(parent, created.root);
    if (
      NodePath.isAbsolute(created.root) &&
      relative !== "" &&
      !relative.startsWith("..") &&
      !NodePath.isAbsolute(relative)
    )
      yield* Effect.forEach(
        yield* plugins.contributions,
        (contribution) =>
          contribution.taskWorktreeCreated?.({
            kind: "task-worktree-created",
            workspace: workspace.slug,
            project: project.id,
            repository: repository.id,
            task: task.id,
            thread: started.threadKey,
            root: created.root,
            identity: created.identity,
          }) ?? Effect.void,
        { discard: true },
      );
  }
  yield* status.publish;
  return {
    paneId: started.paneId,
    terminalId: started.terminalId,
    ...(started.promptError === undefined ? {} : { promptError: started.promptError }),
  } satisfies PeerHubStartAgentResult;
});
