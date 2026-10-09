// @effect-diagnostics nodeBuiltinImport:off - a task's own git worktree beside the person's checkout.
/**
 * Starting an agent on a task in herdr (the plugin's task launcher): a git worktree of its own on
 * a new branch, the agent in a pane of Peer's own herdr workspace, then its first prompt once it is
 * ready for one. Core has checked the task, taken the team request it answers, and puts the agent's
 * thread on the task once it runs.
 *
 * @module peerHub/plugins/herdr/launcher
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PeerTaskLauncher } from "../../core/plugin.ts";
import { isSafeGitRef } from "../../gitSafety.ts";
import { HerdrClient } from "./client/HerdrClient.ts";
import type { HerdrAgents } from "./follower.ts";

type LaunchInput = Parameters<PeerTaskLauncher["launch"]>[0];

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : undefined);

/** A dedicated task checkout; no shell interpolation or edits to the person's current tree. */
export async function prepareHerdrTaskWorktree(input: {
  readonly checkout: string;
  readonly baseBranch: string;
  readonly worktrees: string;
  readonly task: string;
}): Promise<{ readonly cwd: string; readonly branch: string }> {
  if (!NodePath.isAbsolute(input.checkout) || !NodePath.isAbsolute(input.worktrees)) {
    throw new Error("The checkout and worktree directories must be full paths");
  }
  if (!isSafeGitRef(input.baseBranch))
    throw new Error("The repository branch is not a safe Git ref");
  const task =
    input.task
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "task";
  const name = `${task}-${NodeCrypto.randomUUID().slice(0, 8)}`;
  const branch = `feature/${name}`;
  const cwd = NodePath.join(input.worktrees, name);
  await NodeFSP.mkdir(input.worktrees, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", input.checkout, "worktree", "add", "-b", branch, "--", cwd, input.baseBranch],
      { timeout: 15_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, _stdout, stderr) =>
        error === null ? resolve() : reject(new Error(stderr.trim() || error.message)),
    );
  });
  return { cwd, branch };
}

/** Launches task agents in herdr, showing each among herdr's agents at once. */
export const makeLauncher = (agents: HerdrAgents) =>
  Effect.gen(function* () {
    const client = yield* HerdrClient;
    return {
      unavailable: Effect.promise(() => client.list()).pipe(
        Effect.map((listed) =>
          listed === null
            ? "herdr is not running on this environment. Install it from https://herdr.dev/docs/install/, start herdr here, then try again."
            : null,
        ),
      ),
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
        const started = yield* Effect.tryPromise({
          try: () => client.start({ cwd: tree.cwd, harness, env: input.env }),
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
        };
      }),
    } satisfies PeerTaskLauncher;
  });
