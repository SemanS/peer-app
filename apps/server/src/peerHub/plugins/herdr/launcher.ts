// @effect-diagnostics nodeBuiltinImport:off - the new task checkout's identity is read from the file system.
/**
 * Starting an agent on a task in herdr (the plugin's task launcher): a git worktree of its own on
 * a new branch, the agent in a pane of Peer's own herdr workspace, then its first prompt once it is
 * ready for one. Core has checked the task, taken the team request it answers and created the run
 * the agent starts in; the run holds the agent's thread once it runs. A continued run's agent
 * resumes its last provider session where it is known. An agent stopped by its harness's question
 * whether to trust the new checkout keeps its prompt here until the person answers (`answered`).
 *
 * @module peerHub/plugins/herdr/launcher
 */
import * as NodeFSP from "node:fs/promises";

import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { PeerTaskLauncher } from "../../core/plugin.ts";
import { projectsText } from "../../core/work/runRoots.ts";
import { HerdrClient } from "./client/HerdrClient.ts";
import { trustQuestionOf } from "./client/trust.ts";
import { prepareHerdrTaskWorktree } from "./client/worktree.ts";
import type { HerdrAgents } from "./follower.ts";
import { HerdrRuntime } from "./runtime.ts";

type LaunchInput = Parameters<PeerTaskLauncher["launch"]>[0];

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : undefined);

/** How long a trusted agent gets to come up and take its prompt, polled every `PROMPT_POLL_MS`. */
const PROMPT_TRIES = 120;
const PROMPT_POLL_MS = 500;
/** After its prompt, for its first hook to arrive before it stops counting as waiting. */
const SESSION_SETTLES_MS = 30_000;

/** Claude Code reads an added folder's CLAUDE.md only when told to; Codex ignores this. */
export const withDirs = (
  env: Readonly<Record<string, string>>,
  dirs: ReadonlyArray<string>,
): Readonly<Record<string, string>> =>
  dirs.length === 0 ? env : { ...env, CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" };

/** A run across projects is told where the others are in its first prompt. */
export const withProjects = (
  prompt: string,
  also: ReadonlyArray<{ readonly project: string; readonly root: string }>,
) => (also.length === 0 ? prompt : `${prompt}\n${projectsText(also)}`);

/** Launches task agents in herdr, showing each among herdr's agents at once. */
export const makeLauncher = (agents: HerdrAgents) =>
  Effect.gen(function* () {
    const client = yield* HerdrClient;
    const runtime = yield* HerdrRuntime;
    const scope = yield* Effect.scope;
    /** Terminal → the prompt it gets once trusted, from the launch until its session has settled. */
    const held = new Map<string, string | undefined>();

    const agentIn = (terminal: string) =>
      agents.current()?.find((agent) => agent.terminalId === terminal);

    /** Types the held prompt as soon as the agent takes one; herdr refuses until it is ready. */
    const promptOnceReady = (terminal: string) =>
      Effect.gen(function* () {
        const prompt = held.get(terminal) ?? "";
        for (let tries = 0; prompt !== "" && tries < PROMPT_TRIES; tries++) {
          yield* Effect.sleep(PROMPT_POLL_MS);
          yield* agents.refresh;
          const agent = agentIn(terminal);
          if (agent === undefined) return;
          if (agent.status === "blocked" || agent.status === "working") continue;
          const sent = yield* Effect.tryPromise(() =>
            client.prompt(agent.name ?? agent.paneId, prompt),
          ).pipe(Effect.result);
          if (Result.isSuccess(sent)) break;
        }
        yield* Effect.sleep(SESSION_SETTLES_MS);
      }).pipe(Effect.ensuring(Effect.sync(() => held.delete(terminal))));

    return {
      unavailable: runtime.blocker,
      waiting: (threads: ReadonlyArray<string>) =>
        (agents.current() ?? []).some(
          (agent) =>
            (agent.status === "blocked" || held.has(agent.terminalId)) &&
            (threads.includes(agents.keyOf(agent)) ||
              threads.includes(`herdr:${agent.terminalId}`)),
        ),
      /** The person answered the agent in `terminal`: a yes delivers what the launch held. */
      answered: (terminal: string, trust: boolean) =>
        trust
          ? Effect.sync(() => void held.set(terminal, held.get(terminal))).pipe(
              Effect.andThen(promptOnceReady(terminal)),
              Effect.forkIn(scope),
              Effect.asVoid,
            )
          : Effect.sync(() => void held.delete(terminal)),
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
        const also = yield* Effect.forEach(input.also ?? [], (other) =>
          Effect.tryPromise({
            try: async () => {
              const made = await prepareHerdrTaskWorktree({
                checkout: other.checkout,
                baseBranch: other.baseBranch,
                worktrees: other.worktrees,
                task: input.task.key ?? input.task.id,
              });
              const { dev, ino } = await NodeFSP.stat(made.cwd);
              return { project: other.project, root: made.cwd, identity: `${dev}:${ino}` };
            },
            catch: (failure) =>
              hubError(
                `Could not prepare the checkout of ${other.project}: ${messageOf(failure) ?? "check the local repository branch."}`,
              ),
          }),
        );
        const prompt = withProjects(input.prompt, also);
        const dirs = [...(input.dirs ?? []), ...also.map((other) => other.root)];
        const identity = yield* Effect.tryPromise({
          try: () => NodeFSP.stat(tree.cwd),
          catch: () => hubError("The newly created task checkout disappeared before startup."),
        });
        const started = yield* Effect.tryPromise({
          try: () =>
            client.start({
              cwd: tree.cwd,
              harness,
              env: withDirs(input.env, dirs),
              resume: input.resume,
              model: input.model,
              effort: input.effort,
              dirs,
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
        else if (agent.status === "blocked") {
          const screen = yield* Effect.promise(() => client.screen(agent.paneId));
          if (screen !== null && trustQuestionOf(screen) !== null)
            held.set(agent.terminalId, prompt);
          else
            promptError =
              "The agent is waiting for an answer in herdr. Answer it there, then send the task prompt.";
        } else {
          const sent = yield* Effect.tryPromise(() =>
            client.prompt(agent.name ?? agent.paneId, prompt),
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
          alsoTrees: also.map(({ root, identity: made }) => ({ root, identity: made })),
        };
      }),
    } satisfies PeerTaskLauncher & {
      readonly answered: (terminal: string, trust: boolean) => Effect.Effect<void>;
    };
  });
