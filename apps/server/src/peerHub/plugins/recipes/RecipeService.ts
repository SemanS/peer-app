// @effect-diagnostics nodeBuiltinImport:off globalDate:off - operation hashes and the bounded delivery cache's clock.
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  MessageId,
  PeerRecipesError,
  type PeerRecipeSendInput,
  type PeerRecipeSendResult,
  type PeerRecipeTarget,
  type ProjectId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerPlugins } from "../../core/plugins/PeerPlugins.ts";
import { availableRecipes, renderRecipe } from "./catalog.ts";
import { localRecipeAgent } from "./localAgent.ts";
import type { Recipe } from "./generate.ts";
export interface LocalRecipeAgent {
  readonly title: string;
  readonly status: string;
  readonly coordinating: boolean;
  readonly projectId?: ProjectId;
}
export interface RecipePorts {
  readonly available: Effect.Effect<{
    readonly enabled: boolean;
    readonly recipes: ReadonlyArray<Recipe>;
  }>;
  readonly localAgent: (
    target: PeerRecipeTarget,
  ) => Effect.Effect<LocalRecipeAgent | null, PeerRecipesError>;
  readonly prompt: (target: string, text: string) => Effect.Effect<void, PeerRecipesError>;
  readonly threadSend: (
    input: ThreadManagement.ThreadManagementSendInput,
  ) => Effect.Effect<
    Pick<ThreadManagement.ThreadManagementSendResult, "delivery">,
    PeerRecipesError
  >;
}
const error = (message: string) => new PeerRecipesError({ message });
export function makeRecipes(ports: RecipePorts) {
  const lock = Semaphore.makeUnsafe(1);
  const remembered = new Map<
    string,
    {
      fingerprint: string;
      at: number;
      result: Result.Result<PeerRecipeSendResult, PeerRecipesError>;
    }
  >();
  const send = (input: PeerRecipeSendInput) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        for (const [op, row] of remembered) if (now - row.at >= 600_000) remembered.delete(op);
        const fingerprint = [
          input.target.kind,
          input.target.kind === "herdr" ? input.target.agentId : input.target.threadId,
          input.recipe,
          input.input ?? "",
        ]
          .map((value) => `${value.length}:${value}`)
          .join("|");
        const old = remembered.get(input.op);
        if (old) {
          if (old.fingerprint !== fingerprint)
            return yield* Effect.fail(
              error("This operation id belongs to another recipe or input. Start a new operation."),
            );
          return yield* Effect.fromResult(old.result);
        }
        const catalog = yield* ports.available;
        if (!catalog.enabled) return yield* Effect.fail(error("Recipes are turned off here."));
        const recipe = catalog.recipes.find((row) => row.name === input.recipe);
        if (!recipe)
          return yield* Effect.fail(
            error("That recipe is not available. List the available recipes with peer recipe."),
          );
        const text = yield* Effect.try({
          try: () => renderRecipe(recipe, input.input),
          catch: (failure) =>
            error(failure instanceof Error ? failure.message : "Recipe input is invalid."),
        });
        const local = yield* ports.localAgent(input.target);
        if (!local)
          return yield* Effect.fail(
            error(
              "That agent does not run on this computer or its thread was archived. Ask a teammate through a request.",
            ),
          );
        if (!local.coordinating)
          return yield* Effect.fail(
            error(
              "That agent does not coordinate through Peer. Install and trust its hooks first.",
            ),
          );
        if (local.status === "blocked")
          return yield* Effect.fail(
            error("That agent waits for an answer. Answer it in its terminal or thread first."),
          );
        let delivery: PeerRecipeSendResult["delivery"] = "sent";
        if (input.target.kind === "herdr") {
          const sent = yield* Effect.result(ports.prompt(input.target.agentId, text));
          if (Result.isFailure(sent)) {
            remembered.set(input.op, { fingerprint, at: now, result: Result.fail(sent.failure) });
            while (remembered.size > 64) remembered.delete(remembered.keys().next().value!);
            return yield* sent.failure;
          }
        } else {
          if (!local.projectId)
            return yield* Effect.fail(error("The thread's project is unavailable."));
          const id = NodeCrypto.createHash("sha256").update(input.op).digest("hex");
          const reply = yield* ports.threadSend({
            projectId: local.projectId,
            threadId: input.target.threadId,
            commandId: CommandId.make(`peer-recipe:${id}`),
            messageId: MessageId.make(`peer-recipe:${id}`),
            text,
            attachments: [],
            mode: "queue",
            createdBy: "user",
            creationSource: "server",
          });
          delivery = reply.delivery === "queued" ? "queued" : "sent";
        }
        const result = { delivery };
        remembered.set(input.op, { fingerprint, at: now, result: Result.succeed(result) });
        while (remembered.size > 64) remembered.delete(remembered.keys().next().value!);
        return result;
      }),
    );
  return {
    available: ports.available,
    list: ports.available.pipe(
      Effect.map(({ enabled, recipes }) => ({
        enabled,
        recipes: recipes.map(({ name, title, hint, access }) => ({
          name,
          title,
          ...(hint === undefined ? {} : { hint }),
          access,
        })),
      })),
    ),
    send,
    forget: Effect.sync(() => remembered.clear()),
  };
}
export class RecipeService extends Context.Service<
  RecipeService,
  ReturnType<typeof makeRecipes> & {
    readonly bindThreads: (service: ThreadManagement.ThreadManagementServiceShape) => void;
  }
>()("t3/peerHub/plugins/recipes/RecipeService") {}
export const layer = Layer.effect(
  RecipeService,
  Effect.gen(function* () {
    const plugins = yield* PeerPlugins,
      agents = yield* PeerAgents,
      projection = yield* ProjectionStore.ProjectionStoreV2;
    let threads: ThreadManagement.ThreadManagementServiceShape | undefined;
    const available = plugins.active.pipe(
      Effect.map((active) => {
        const on = new Set<string>(active.map((row) => row.id));
        return { enabled: on.has("recipes"), recipes: availableRecipes((id) => on.has(id)) };
      }),
    );
    const localAgent = localRecipeAgent({
      sessions: agents.sessions,
      runtimes: agents.runtimeAgents,
      level: agents.level,
      shell: (id) =>
        projection
          .getThreadShell(id)
          .pipe(Effect.mapError(() => error("The thread could not be read."))),
    });
    return {
      ...makeRecipes({
        available,
        localAgent,
        prompt: (id, text) =>
          agents.promptRuntime(id, text).pipe(Effect.mapError((e) => error(e.detail))),
        threadSend: (input) =>
          threads
            ? threads.sendToThread(input).pipe(Effect.mapError((e) => error(e.message)))
            : Effect.fail(error("Thread delivery is still starting. Try again shortly.")),
      }),
      bindThreads: (service) => {
        threads = service;
      },
    };
  }),
);
