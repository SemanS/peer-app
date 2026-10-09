import {
  WS_METHODS,
  type PeerHubStatus,
  type PeerRecipeTarget,
  type PeerRecipeSendResult,
  type PeerRecipesListResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { EnvironmentThreadShell } from "../state/models.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";
import { request } from "../rpc/client.ts";
export interface AskableAgent {
  readonly target: PeerRecipeTarget;
  readonly title: string;
  readonly status: string;
  readonly reason?: string;
}
const threadId = Schema.decodeSync(ThreadId);
const waiting = "Waiting for an answer; answer in the agent before sending a recipe.";
/** Own live shells fill the gap before this computer's next Hub work report. */
export function askableAgents(
  status: PeerHubStatus,
  place: { workspace: string; project: string; task: string },
  localThreads: ReadonlyArray<EnvironmentThreadShell> = [],
): ReadonlyArray<AskableAgent> {
  const project = status.workspaces
    .find((w) => w.slug === place.workspace)
    ?.projects.find((p) => p.project.id === place.project);
  if (!project || !status.email) return [];
  const rows: AskableAgent[] = [];
  const add = (target: PeerRecipeTarget, title: string, state: string) =>
    rows.push({
      target,
      title,
      status: state,
      ...(state === "blocked" ? { reason: waiting } : {}),
    });
  for (const agent of status.agents.list) {
    if (
      agent.workspace !== place.workspace ||
      agent.projectId !== place.project ||
      project.work.assignments[agent.id] !== place.task ||
      !["A", "B"].includes(agent.coordinationLevel ?? "") ||
      agent.status === "done"
    )
      continue;
    add({ kind: "herdr", agentId: agent.id }, agent.title, agent.status);
  }
  const known = new Set<string>();
  for (const thread of project.work.threads) {
    if (
      thread.source !== "peer" ||
      thread.email !== status.email ||
      thread.environment !== status.environmentId
    )
      continue;
    known.add(thread.id);
    if (
      (project.work.assignments[thread.id] ?? thread.task) !== place.task ||
      !["claude", "codex"].includes(thread.harness ?? "") ||
      thread.runtimePresent === false ||
      thread.status === "done" ||
      !thread.id.startsWith("peer:")
    )
      continue;
    add({ kind: "thread", threadId: threadId(thread.id.slice(5)) }, thread.title, thread.status);
  }
  const projectIds = new Set(
    project.repositories.flatMap((r) => (r.projectId ? [r.projectId] : [])),
  );
  for (const thread of localThreads) {
    if (
      known.has(`peer:${thread.id}`) ||
      thread.environmentId !== status.environmentId ||
      !projectIds.has(thread.projectId) ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      project.work.assignments[`peer:${thread.id}`] !== place.task ||
      !thread.runtime ||
      !/^(codex|claude(?:[ -]?code)?)$/i.test(thread.runtime.providerName ?? "") ||
      !["running", "idle", "waiting", "starting", "preparing", "queued"].includes(
        thread.runtime.status,
      )
    )
      continue;
    add(
      { kind: "thread", threadId: thread.id },
      thread.title,
      thread.hasPendingApprovals || thread.hasPendingUserInput
        ? "blocked"
        : thread.runtime.status === "idle"
          ? "idle"
          : "working",
    );
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}
export function recipesOrUnavailable<A extends PeerRecipesListResult, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | PeerRecipesListResult, E, R> {
  return effect.pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : String(error);
      return /unknown (?:rpc )?method|unknown request tag:\s*peer[.]recipes[.]list|method (?:not found|does not exist)|unimplemented.*peer[.]recipes/i.test(
        message,
      )
        ? Effect.succeed({ enabled: false, recipes: [] })
        : Effect.failCause(cause);
    }),
  );
}
export interface RecipeOperation {
  readonly draft: string;
  readonly id: string;
}
export function recipeOperation(
  previous: RecipeOperation | null,
  target: PeerRecipeTarget,
  recipe: string,
  input: string,
  id: () => string,
): RecipeOperation {
  const draft = JSON.stringify([target, recipe, input]);
  return previous?.draft === draft ? previous : { draft, id: id() };
}
export const recipeDeliveryText = (title: string, result: PeerRecipeSendResult) =>
  `${result.delivery === "queued" ? "Queued for" : "Sent to"} ${title}`;
export function createRecipesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:peer.recipes.list",
      staleTimeMs: 0,
      idleTtlMs: 0,
      execute: (_input: { readonly revision?: string }) =>
        recipesOrUnavailable(request(WS_METHODS.peerRecipesList, undefined)),
    }),
    send: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.recipes.send",
      tag: WS_METHODS.peerRecipesSend,
    }),
  };
}
