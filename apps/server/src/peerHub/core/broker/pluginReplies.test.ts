import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";
describe("generic plugin command replies and context ledgers", () => {
  it("appends a dummy note only after a committed command; read receipts remain explicit", async () => {
    let fail = false,
      notes = 0,
      commits = 0;
    const fixture = await brokerFixture(() => ({
      taskOf: () => "work",
      finishTask: async () => {
        if (fail) throw Error("refused");
        commits++;
      },
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [
          {
            id: "knowledge",
            title: "dummy",
            contributions: {
              commandReply: (session) =>
                Effect.sync(() => {
                  notes++;
                  expect(session.contextReadVersion?.("task:other")).toBe(7);
                  session.tellIndex?.("task:other");
                  return "A dummy note.";
                }),
            },
          },
        ],
      }),
    }));
    try {
      await fixture.register("test");
      const session = fixture.broker["sessions"].get("claude:test")!;
      session.read.set("task:other", { version: 7, text: "old", notifiedVersion: 7, toldAt: 0 });
      const headers = { "x-peer-session": "claude:test" };
      vi.spyOn(fixture.broker, "indexWorks").mockReturnValue([
        { scope: "task:other", handle: "OTHER", name: "Other", agents: [], version: 7 },
      ]);
      expect(await fixture.broker["runCli"]("review", [], headers)).toBe(
        "Task moved to review with current shared input versions.\nA dummy note.",
      );
      expect(commits).toBe(1);
      expect(notes).toBe(1);
      expect(session.read.get("task:other")?.version).toBe(7);
      expect(session.told.has("task:other")).toBe(true);
      fail = true;
      await expect(fixture.broker["runCli"]("done", [], headers)).rejects.toThrow();
      expect(notes).toBe(1);
      expect(commits).toBe(1);
    } finally {
      await fixture.dispose();
    }
  });
});
