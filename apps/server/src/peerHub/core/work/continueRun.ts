// @effect-diagnostics nodeBuiltinImport:off - where a task's own checkout goes under the workspace root.
/**
 * Continuing a detached run (`peerHub.continueRun`, design D6): a new session in the run. A Peer
 * thread's run wakes its thread as a teammate's news would; a herdr run starts again through the
 * task launcher with the run's identity, resuming its last provider session where this computer
 * has it; a terminal run continues in the terminal, where its person runs it.
 *
 * A run another computer of the same person minted is taken over first (design D8): the Hub hands
 * it to this environment, this computer keeps it as its own with a token minted here, and it
 * continues as a local run. Its provider session stays on the other computer, so it starts on the
 * task's prompt.
 *
 * @module peerHub/core/work/continueRun
 */
import * as NodePath from "node:path";

import {
  PeerHarness,
  type PeerHubContinueRunInput,
  type PeerHubContinueRunResult,
  type PeerRun,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as PeerAgents from "../coordination/PeerAgents.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import type { PersistedRun } from "../state/PeerState.ts";
import * as PeerWork from "./PeerWork.ts";
import * as PeerRuns from "./runs.ts";
import { stateOf } from "./runs.ts";

const isHarness = Schema.is(PeerHarness);
const notStarted = (reason: string): PeerHubContinueRunResult => ({ started: false, reason });

/** Why a run cannot continue here at all, before anything changes; null when it can. */
const blocked = (run: Pick<PeerRun, "id" | "runtime" | "agent">, handedOver: boolean) => {
  switch (run.runtime) {
    case "mcp":
      return "Continue it from the editor it ran in.";
    case "peer":
      // A Peer thread lives in the app of the computer that ran it.
      return handedOver ? "Its Peer chat is on the computer that ran it; continue it there." : null;
    case "herdr":
      return isHarness(run.agent) ? null : `herdr cannot start ${run.agent} again.`;
    case "terminal":
      return null;
  }
};

/**
 * Another computer's run of this person, as the Hub keeps it, or why it cannot be taken over. A run
 * of another person's, or of a Hub without runs, stays where it is.
 */
const foreignRun = (runs: PeerRuns.PeerRuns["Service"], input: PeerHubContinueRunInput) =>
  Effect.gen(function* () {
    const email = (yield* (yield* PeerState.PeerState).email)?.toLowerCase();
    const run = (yield* runs
      .list({ workspace: input.workspace, projectId: input.projectId })
      .pipe(Effect.orElseSucceed((): ReadonlyArray<PeerRun> => []))).find(
      (candidate) => candidate.id === input.runId,
    );
    if (run === undefined || email === undefined || run.email.toLowerCase() !== email)
      return "This run was started on another computer; continue it there.";
    if (run.state !== "detached")
      return run.state === "ended" ? "This run has ended." : "This run is running now.";
    return run;
  });

export const continueRun = Effect.fn("PeerRuns.continueRun")(function* (
  input: PeerHubContinueRunInput,
) {
  const runs = yield* PeerRuns.PeerRuns;
  const own = runs.book.get(input.runId);
  let run: PersistedRun;
  let handedOver = false;
  if (own === undefined) {
    const foreign = yield* foreignRun(runs, input);
    if (typeof foreign === "string") return notStarted(foreign);
    const reason = blocked(foreign, true);
    if (reason !== null) return notStarted(reason);
    const taken = yield* runs.takeOver(foreign).pipe(Effect.result);
    if (taken._tag === "Failure") return notStarted(taken.failure.detail);
    run = taken.success;
    handedOver = true;
  } else {
    if (own.workspace !== input.workspace || own.project !== input.projectId)
      return notStarted("That run is not on this project.");
    run = own;
  }
  const state = stateOf(run);
  if (state !== "detached")
    return notStarted(state === "ended" ? "This run has ended." : "This run is running now.");
  const reason = blocked(run, handedOver);
  if (reason !== null) return notStarted(reason);
  switch (run.runtime) {
    case "terminal":
      return notStarted(
        `${handedOver ? "This computer has the run now; " : ""}continue it with peer core runs continue ${run.id}`,
      );
    case "mcp":
      return notStarted("Continue it from the editor it ran in.");
    case "peer": {
      const last = run.sessions.at(-1);
      if (run.thread === undefined || last === undefined)
        return notStarted("Peer cannot wake this run's thread here now.");
      const queued = yield* (yield* PeerAgents.PeerAgents).queueNative(
        last.id,
        `Peer: your person continues run ${run.id}. Pick the task up where the run left it.`,
        run.thread,
      );
      return queued ? { started: true } : notStarted("Peer could not wake this thread's agent.");
    }
    case "herdr":
      return yield* continueInHerdr(runs, run, handedOver);
  }
});

/** A herdr run starts again through the task launcher, in its checkout, with its identity. */
const continueInHerdr = (
  runs: PeerRuns.PeerRuns["Service"],
  run: PersistedRun,
  handedOver: boolean,
) =>
  Effect.gen(function* () {
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
    // The provider keeps a session's conversation on the computer that ran it.
    const resume =
      handedOver || identity.resume === undefined
        ? undefined
        : { agent: identity.resume.agent, session: identity.resume.nativeId };
    const name = `${task.key === undefined ? "" : `${task.key}: `}${task.title}`;
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
      prompt:
        resume === undefined
          ? `${name}. You continue run ${run.id} on this task; read your working context and the task's shared context before you change anything.`
          : `Peer: your person continues run ${run.id} on ${name}. Pick it up where you left it.`,
      env: identity.env,
      resume,
    });
    yield* Effect.promise(() =>
      runs.book.hold(run.id, started.threadKey, started.paneId).catch(() => undefined),
    );
    return { started: true } satisfies PeerHubContinueRunResult;
  });
