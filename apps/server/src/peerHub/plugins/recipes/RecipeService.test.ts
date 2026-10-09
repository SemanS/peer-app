import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { PeerRecipesError, ThreadId, ProjectId } from "@t3tools/contracts";
import { makeRecipes, type RecipePorts } from "./RecipeService.ts";
import { renderRecipe } from "./catalog.ts";
import { recipeTable } from "./recipeTable.generated.ts";
const setup = () => {
  let enabled = true,
    local = true,
    coordinating = true,
    blocked = false;
  const prompts: string[] = [];
  const queued: Parameters<RecipePorts["threadSend"]>[0][] = [];
  const ports: RecipePorts = {
    available: Effect.sync(() => ({ enabled, recipes: enabled ? recipeTable : [] })),
    localAgent: () =>
      Effect.sync(() =>
        local
          ? {
              title: "Mine",
              status: blocked ? "blocked" : "running",
              coordinating,
              projectId: ProjectId.make("p"),
            }
          : null,
      ),
    prompt: (_target, text) => Effect.sync(() => void prompts.push(text)),
    threadSend: (input) =>
      Effect.sync(() => {
        queued.push(input);
        return { delivery: "queued" };
      }),
  };
  const service = makeRecipes(ports);
  return {
    service,
    prompts,
    queued,
    set: (changes: {
      enabled?: boolean;
      local?: boolean;
      coordinating?: boolean;
      blocked?: boolean;
    }) => {
      enabled = changes.enabled ?? enabled;
      local = changes.local ?? local;
      coordinating = changes.coordinating ?? coordinating;
      blocked = changes.blocked ?? blocked;
    },
  };
};
it.effect(
  "renders each exact procedure and queues behind a running thread with user provenance",
  () =>
    Effect.gen(function* () {
      const f = setup();
      for (const row of recipeTable) {
        yield* f.service.send({
          target: { kind: "herdr", agentId: "mine" },
          recipe: row.name,
          input: "$& {{input}}",
          op: row.name,
        });
        expect(f.prompts.at(-1)).toBe(renderRecipe(row, "$& {{input}}"));
        yield* f.service.send({
          target: { kind: "thread", threadId: ThreadId.make("thread") },
          recipe: row.name,
          input: "words",
          op: `thread-${row.name}`,
        });
        expect(f.queued.at(-1)).toMatchObject({
          text: renderRecipe(row, "words"),
          mode: "queue",
          createdBy: "user",
          creationSource: "server",
          attachments: [],
        });
      }
    }),
);
it.effect(
  "refuses missing or archived targets, colleagues, uncoordinated and blocked agents, and disabled recipes",
  () =>
    Effect.gen(function* () {
      for (const state of [
        { local: false },
        { coordinating: false },
        { blocked: true },
        { enabled: false },
      ]) {
        const f = setup();
        f.set(state);
        const error = yield* Effect.flip(
          f.service.send({
            target: { kind: "herdr", agentId: "other" },
            recipe: "catch-up",
            op: "x",
          }),
        );
        expect(error._tag).toBe("PeerRecipesError");
        expect(f.prompts).toEqual([]);
        expect(f.queued).toEqual([]);
      }
      const f = setup();
      const unavailable = yield* Effect.flip(
        f.service.send({ target: { kind: "herdr", agentId: "mine" }, recipe: "missing", op: "x" }),
      );
      expect(unavailable.message).toMatch(/available/);
    }),
);
it.effect("retries without a second prompt and refuses operation reuse with changed contents", () =>
  Effect.gen(function* () {
    const f = setup();
    const input = {
      target: { kind: "herdr" as const, agentId: "mine" },
      recipe: "catch-up",
      input: "words",
      op: "x",
    };
    const a = yield* f.service.send(input),
      b = yield* f.service.send(input);
    expect(a).toEqual(b);
    expect(f.prompts).toHaveLength(1);
    yield* f.service.send({ ...input, op: "y" });
    expect(f.prompts).toHaveLength(2);
    const reused = yield* Effect.flip(f.service.send({ ...input, input: "changed" }));
    expect(reused.message).toMatch(/operation/);
  }),
);

it.effect("never repeats an uncertain terminal submission with the same operation", () =>
  Effect.gen(function* () {
    let calls = 0;
    const service = makeRecipes({
      available: Effect.succeed({ enabled: true, recipes: recipeTable }),
      localAgent: () => Effect.succeed({ title: "Mine", status: "working", coordinating: true }),
      prompt: () =>
        Effect.sync(() => {
          calls++;
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new PeerRecipesError({ message: "Reply lost; read the agent before retrying." }),
            ),
          ),
        ),
      threadSend: () => Effect.succeed({ delivery: "queued" }),
    });
    const input = {
      target: { kind: "herdr" as const, agentId: "mine" },
      recipe: "catch-up",
      op: "lost",
    };
    const first = yield* Effect.flip(service.send(input)),
      second = yield* Effect.flip(service.send(input));
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  }),
);

it.effect("bounds remembered terminal operations to 64 and expires them after ten minutes", () =>
  Effect.gen(function* () {
    const f = setup();
    const input = {
      target: { kind: "herdr" as const, agentId: "mine" },
      recipe: "catch-up",
      op: "0",
    };
    for (let n = 0; n < 65; n++) yield* f.service.send({ ...input, op: String(n) });
    expect(f.prompts).toHaveLength(65);
    yield* f.service.send(input);
    expect(f.prompts).toHaveLength(66);
    yield* TestClock.adjust("10 minutes");
    yield* f.service.send(input);
    expect(f.prompts).toHaveLength(67);
  }),
);
