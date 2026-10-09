import { expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";
it("runs post-review steps after commitment in order, bounds the budget and preserves refusals/done", async () => {
  let committed = false,
    fail = false,
    count = 0;
  const fixture = await brokerFixture(() => ({
    taskOf: () => "work",
    finishTask: async () => {
      if (fail) throw Error("refused");
      committed = true;
    },
    plugins: async () => ({
      ...NO_PLUGINS,
      active: [
        {
          id: "knowledge",
          title: "one",
          contributions: {
            afterReview: ({ remainingMs }) =>
              Effect.sync(() => {
                expect(committed).toBe(true);
                expect(remainingMs).toBeLessThanOrEqual(10000);
                expect(remainingMs).toBeGreaterThanOrEqual(0);
                count++;
                return ["First"];
              }),
          },
        },
        {
          id: "find",
          title: "two",
          contributions: { afterReview: () => Effect.succeed(["Second"]) },
        },
        { id: "ask", title: "broken", contributions: { afterReview: () => Effect.die("broken") } },
      ],
    }),
  }));
  try {
    await fixture.register("test");
    const headers = { "x-peer-session": "claude:test" };
    expect(await fixture.broker["runCli"]("review", [], headers)).toBe(
      "Task moved to review with current shared input versions.\nFirst\nSecond",
    );
    expect(await fixture.broker["runCli"]("done", [], headers)).toBe(
      "Task moved to done with current shared input versions.",
    );
    expect(count).toBe(1);
    fail = true;
    await expect(fixture.broker["runCli"]("review", [], headers)).rejects.toThrow();
    expect(count).toBe(1);
  } finally {
    vi.restoreAllMocks();
    await fixture.dispose();
  }
});
