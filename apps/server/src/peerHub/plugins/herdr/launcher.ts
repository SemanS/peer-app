// @effect-diagnostics nodeBuiltinImport:off - the new task checkout's identity is read from the file system.
/**
 * Starting an agent on a task in herdr (the plugin's task launcher): a git worktree of its own on
 * a new branch, the agent in a pane of Peer's own herdr workspace, then its first prompt once it is
 * ready for one. Core has checked the task, taken the team request it answers and created the run
 * the agent starts in; the run holds the agent's thread once it runs. A continued run's agent
 * resumes its last provider session where it is known.
 *
 * @module peerHub/plugins/herdr/launcher
 */
import * as NodeFSP from "node:fs/promises";

import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PeerTaskLauncher } from "../../core/plugin.ts";
import { HerdrClient } from "./client/HerdrClient.ts";
import { prepareHerdrTaskWorktree } from "./client/worktree.ts";
import type { HerdrAgents } from "./follower.ts";
import { HerdrRuntime } from "./runtime.ts";

type LaunchInput = Parameters<PeerTaskLauncher["launch"]>[0];

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : undefined);

/** Launches task agents in herdr, showing each among herdr's agents at once. */
export const makeLauncher = (agents: HerdrAgents) =>
  Effect.gen(function* () {
    const client = yield* HerdrClient;
    const runtime = yield* HerdrRuntime;
    return {
      unavailable: runtime.blocker,
      launch: Effect.fn("Herdr.launch")(function* (input: LaunchInput) {
        const harness = input.harness;
        if (harness !== "claude" && harness !== "codex")
          return yield* hubError(`herdr cannot start a ${harness} agent.`);
        const tree = yield* Effect.tryPromise({
          try: () =>
            prepareHerdrTaskWorktree({
              checkout: input.checkout,
              baseBranch: input.baseBranch,
              worktrees: input.worktrees,
              task: input.task.key ?? input.task.id,
            }),
          catch: (failure) =>
            hubError(
              `Could not prepare the task checkout: ${messageOf(failure) ?? "check the local repository branch."}`,
            ),
        });
        const identity = yield* Effect.tryPromise({
          try: () => NodeFSP.stat(tree.cwd),
          catch: () => hubError("The newly created task checkout disappeared before startup."),
        });
        const started = yield* Effect.tryPromise({
          try: () =>
            client.start({
              cwd: tree.cwd,
              harness,
              env: input.env,
              resume: input.resume,
              model: input.model,
              effort: input.effort,
            }),
          catch: (failure) => {
            const message = messageOf(failure);
            return hubError(
              `herdr did not start the agent${message === undefined ? "." : `: ${message}`} The task checkout remains at ${tree.cwd}.`,
            );
          },
        });
        // Show it at once; herdr's events would say within a moment.
        yield* agents.refresh;
        const agent = agents.current()?.find((one) => one.terminalId === started.terminalId);
        let promptError = started.promptError;
        if (agent === undefined)
          promptError =
            "The agent started but is not visible yet. Check herdr before sending its task prompt.";
        else if (agent.status === "blocked")
          promptError =
            "The agent is waiting for an answer in herdr. Answer it there, then send the task prompt.";
        else {
          const sent = yield* Effect.tryPromise(() =>
            client.prompt(agent.name ?? agent.paneId, input.prompt),
          ).pipe(Effect.result);
          if (sent._tag === "Failure")
            promptError = `The task prompt could not be confirmed. Read the agent before retrying: ${sent.failure.cause instanceof Error ? sent.failure.cause.message : "herdr did not answer"}.`;
        }
        return {
          paneId: started.paneId,
          terminalId: started.terminalId,
          ...(promptError === undefined ? {} : { promptError }),
          threadKey: agent === undefined ? `herdr:${started.terminalId}` : agents.keyOf(agent),
          worktree: { root: tree.cwd, identity: `${identity.dev}:${identity.ino}` },
        };
      }),
    } satisfies PeerTaskLauncher;
  });
