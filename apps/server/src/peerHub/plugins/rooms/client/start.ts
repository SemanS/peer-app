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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerPlugins from "../../../core/plugins/PeerPlugins.ts";
import type * as PeerState from "../../../core/state/PeerState.ts";
import { projectKey } from "../../../core/state/PeerState.ts";
import type * as PeerWork from "../../../core/work/PeerWork.ts";
import { runRootsData, type RunRoot } from "../../../core/work/runRoots.ts";
import { run } from "../../../core/local.ts";
import { NO_CHECKOUT } from "../follow.ts";
import { chatRunPrompt, passedRunPrompt, reviewRoomPrompt, type Heard } from "../text.ts";

const isHarness = Schema.is(PeerHarness);
const refusal = (detail: string) => new PeerHubError({ detail, refused: true });
const isReview = (harness: string): harness is "claude" | "codex" =>
  harness === "claude" || harness === "codex";

/**
 * The harness of a start: the one its author named when the turn is theirs, else the first the
 * person declared, else Claude Code. A colleague's message starts a turn on the owner's capacity,
 * so it does not get to choose which of the owner's subscriptions pays for it.
 */
export const harnessOf = (
  item: PeerRoomInboxItem,
  me: string,
  project: Pick<PeerProject, "capacity">,
) => {
  const mine = (email: string) => email.toLowerCase() === me.toLowerCase();
  const named = mine(item.message.author.email)
    ? item.message.to.find((target) => target.kind === "agent" && mine(target.email))?.harness
    : undefined;
  return named ?? project.capacity.personalHarnesses.find(isReview) ?? "claude";
};

/** What its author chose, and only theirs: it ends up on the agent's command line. */
export const choiceOf = (item: PeerRoomInboxItem, me: string) => {
  if (item.message.author.email.toLowerCase() !== me.toLowerCase()) return {};
  const target = item.message.to.find(
    (candidate) => candidate.kind === "agent" && candidate.email.toLowerCase() === me.toLowerCase(),
  );
  return { model: target?.model, effort: target?.effort };
};

const needsApproval = (project: Pick<PeerProject, "capacity">) =>
  project.capacity.personal !== "any";

const isModelName = (model: string) => /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]*$/.test(model);
const isEffort = (effort: string) => /^[a-z]+$/.test(effort);

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

/** What carries a run of this computer. */
export const capacityOf = (
  state: PeerState.PeerState["Service"],
  work: PeerWork.PeerWork["Service"],
  workspace: string,
  project: string,
  run: string,
) =>
  Effect.gen(function* () {
    const { persisted } = yield* state.read;
    return runCapacity(
      persisted.runs?.[run],
      persisted.sharedInstances[projectKey(workspace, project)] ?? [],
      (yield* work.latestPass)?.threads ?? [],
    );
  });

/** The person's open runs on the task kept on this computer, newest first. */
export const openRuns = (
  state: PeerState.PeerState["Service"],
  place: { readonly workspace: string; readonly project: string; readonly task: string },
) =>
  Effect.map(state.read, ({ persisted }) =>
    Object.values(persisted.runs ?? {})
      .filter(
        (run) =>
          run.workspace === place.workspace &&
          run.project === place.project &&
          run.task === place.task &&
          run.endedAt === undefined,
      )
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );

/** The other open chats of a shared room that this computer has a checkout for. */
const sharedRooms = (
  state: PeerState.PeerState["Service"],
  work: PeerWork.PeerWork["Service"],
  workspace: string,
  home: string,
  group: string | undefined,
) =>
  Effect.gen(function* () {
    if (group === undefined) return [];
    const known = (yield* state.workspaces).find((candidate) => candidate.slug === workspace);
    const found = [];
    for (const { id } of known?.manifest?.projects ?? []) {
      if (id === home) continue;
      const task = (yield* work.tasks(workspace, id)).find(
        (candidate) => candidate.group === group && candidate.status !== "done",
      );
      if (task === undefined) continue;
      const { project } = yield* state.project(workspace, id);
      const checkout = yield* checkoutOf(state, workspace, project);
      if (checkout !== undefined) found.push({ project, task, checkout });
    }
    return found;
  });

/** The branch a folder of no Hub project stands on, else its remote's default. */
const baseOf = async (folder: string) => {
  const name = (args: ReadonlyArray<string>) =>
    run("git", ["-C", folder, "symbolic-ref", "--short", ...args], { timeoutMs: 5_000 }).then(
      (out) => out.trim(),
      () => "",
    );
  return (
    (await name(["HEAD"])) ||
    (await name(["refs/remotes/origin/HEAD"])).replace(/^origin\//, "") ||
    "main"
  );
};

/** The folders a shared room's agent works in besides its Hub projects, as `launch` takes them. */
const roomFolders = (state: PeerState.PeerState["Service"], group: string | undefined) =>
  Effect.gen(function* () {
    if (group === undefined) return [];
    const stored = Option.getOrUndefined(yield* runRootsData(state).read);
    return yield* Effect.forEach(stored?.folders?.[group] ?? [], ({ name, folder }) =>
      Effect.promise(async () => ({
        project: name,
        checkout: folder,
        baseBranch: await baseOf(folder),
        worktrees: NodePath.join(
          state.workspaceRoot,
          ".worktrees",
          "_folders",
          NodePath.basename(folder),
        ),
      })),
    );
  });

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
    /** A session with role `review` on the person's capacity. */
    review: (
      workspace: string,
      item: PeerRoomInboxItem,
      me: string,
      heard: Heard,
      /** The change it reads, fetched, so it does not answer from the base branch. */
      change: { readonly ref: string; readonly base: string } | undefined,
    ) =>
      Effect.gen(function* () {
        const { project, task, checkout } = yield* placeOf(workspace, item);
        const harness = harnessOf(item, me, project);
        if (!isReview(harness))
          return yield* refusal("Peer starts a review session with Claude Code or Codex only.");
        const { model, effort } = choiceOf(item, me);
        if (
          (model !== undefined && !isModelName(model)) ||
          (effort !== undefined && !isEffort(effort))
        )
          return yield* refusal("Peer cannot start that model.");
        const starter = yield* plugins.require("reviewStarter");
        const started = yield* starter.start({
          workspace,
          projectId: project.id,
          taskId: task.id,
          repositoryId: checkout.repository.id,
          harness,
          ...(model === undefined ? {} : { model }),
          ...(effort === undefined ? {} : { effort }),
          ...(change === undefined ? {} : { baseBranch: change.base }),
          prompt: reviewRoomPrompt(heard, change?.ref),
        });
        return {
          run: started.run ?? started.thread,
          typed: started.promptError === undefined,
        };
      }),
    /** A working run its owner's Pass on starts. */
    work: (workspace: string, item: PeerRoomInboxItem, me: string, heard: Heard) =>
      Effect.gen(function* () {
        const { project, task, checkout } = yield* placeOf(workspace, item);
        const harness = harnessOf(item, me, project);
        if (!isHarness(harness)) return yield* refusal(`Peer cannot start ${harness} here.`);
        const others = yield* sharedRooms(state, work, workspace, project.id, task.group);
        // One agent carries them all, so the strictest project decides what may run it.
        if ([project, ...others.map((other) => other.project)].some(needsApproval))
          return yield* refusal("This project needs an approved commercial or shared provider.");
        const { model, effort } = choiceOf(item, me);
        if (
          (model !== undefined && !isModelName(model)) ||
          (effort !== undefined && !isEffort(effort))
        )
          return yield* refusal("Peer cannot start that model.");
        const folders = yield* roomFolders(state, task.group);
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
              prompt: task.chat === true ? chatRunPrompt(heard) : passedRunPrompt(heard),
              env,
              also: [
                ...others.map((other) => ({
                  project: other.project.name,
                  checkout: other.checkout.path,
                  baseBranch: other.checkout.repository.branch,
                  worktrees: NodePath.join(
                    state.workspaceRoot,
                    ".worktrees",
                    workspace,
                    other.project.id,
                    other.checkout.repository.id,
                  ),
                })),
                ...folders,
              ],
              ...(model === undefined ? {} : { model }),
              ...(effort === undefined ? {} : { effort }),
            }),
        );
        const roots: ReadonlyArray<RunRoot> = others.flatMap((other, index) => {
          const tree = started.alsoTrees?.[index];
          return tree === undefined
            ? []
            : [
                {
                  project: other.project.id,
                  repository: other.checkout.repository.id,
                  task: other.task.id,
                  root: tree.root,
                },
              ];
        });
        const folderRoots: ReadonlyArray<RunRoot> = folders.flatMap((folder, index) => {
          const tree = started.alsoTrees?.[others.length + index];
          return tree === undefined
            ? []
            : [{ project: folder.project, repository: "", task: "", root: tree.root }];
        });
        if (roots.length + folderRoots.length > 0) {
          yield* runRootsData(state)
            .update((current) => {
              const stored = Option.getOrUndefined(current);
              return { ...stored, runs: { ...stored?.runs, [run]: [...roots, ...folderRoots] } };
            })
            .pipe(state.lock.withPermits(1));
          // The same record as the run's own checkout, so it is cleaned up when its task is done.
          const contributions = yield* plugins.contributions;
          yield* Effect.forEach(
            roots,
            (root, index) =>
              Effect.forEach(
                contributions,
                (contribution) =>
                  contribution.taskWorktreeCreated?.({
                    kind: "task-worktree-created",
                    workspace,
                    project: root.project,
                    repository: root.repository,
                    task: root.task,
                    thread: started.threadKey,
                    root: root.root,
                    identity: started.alsoTrees?.[index]?.identity ?? "",
                  }) ?? Effect.void,
                { discard: true },
              ),
            { discard: true },
          );
        }
        yield* work.refresh().pipe(state.lock.withPermits(1));
        return { run, typed: started.promptError === undefined };
      }),
  };
};
