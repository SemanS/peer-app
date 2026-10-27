import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { keepingFlows } from "./keeping.ts";

type Deps = Parameters<typeof keepingFlows>[0];

/** Only what harvest reaches; the rest of keeping's dependencies stay unused. */
function harvestOnly(contextText: string | null) {
  const read: string[] = [];
  const proposed: Array<{ text: string; origin?: string; task?: string }> = [];
  const store = {
    checkout: "/repo",
    llm: true,
    kontext: {
      harvest: async (input: { text: string }) => {
        read.push(input.text);
        return [{ title: "Prices are whole cents", kind: "decision", body: "", paths: [] }];
      },
    },
  };
  const deps = {
    state: { pluginData: () => ({}) },
    client: {
      session: Effect.succeed({ hubUrl: "https://hub", session: "s" }),
      api: {
        readContext: () =>
          Effect.succeed(contextText === null ? null : { text: contextText, version: 3 }),
      },
    },
    agents: { hubChanged: Effect.void },
    work: { taskName: () => Effect.succeed("Checkout") },
    status: {},
    hub: {
      propose: (_workspace: string, _project: string, input: (typeof proposed)[number]) =>
        Effect.sync(() => void proposed.push(input)),
    },
    statusOf: () => Effect.die("unused"),
    checkoutOf: () => Effect.die("unused"),
    storeOf: () => Effect.succeed(store),
  } as unknown as Deps;
  return { flows: keepingFlows(deps), read, proposed };
}

describe("harvest", () => {
  it.effect("reads the conversations a person sends instead of the shared context", () =>
    Effect.gen(function* () {
      const { flows, read, proposed } = harvestOnly("the saved context");
      const result = yield* flows.harvest({
        workspace: "acme",
        project: "shop",
        scope: "project",
        conversations: "## Prices\nAgent reply: prices are integers now.",
      });
      expect(result).toEqual({ proposed: 1 });
      expect(read).toEqual(["## Prices\nAgent reply: prices are integers now."]);
      expect(proposed[0]?.origin).toBe("conversations:project");
    }),
  );

  it.effect("reads the shared context, naming its version, when no conversations are sent", () =>
    Effect.gen(function* () {
      const { flows, read, proposed } = harvestOnly("the saved context");
      yield* flows.harvest({ workspace: "acme", project: "shop", scope: "task:t1" });
      expect(read).toEqual(["the saved context"]);
      expect(proposed[0]).toMatchObject({ origin: "context:task:t1@v3", task: "t1" });
    }),
  );
});
