// @effect-diagnostics globalDate:off - a broker on a temporary checkout.
import { PeerHubError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { brokerFixture } from "./testkit.ts";

const headers = { "x-peer-session": "one" };
const tasks = [{ id: "other", key: "KRK-7", title: "Other work", status: "review" }];

describe("peer command outcomes", () => {
  it("rejects invalid arguments and local refusals without changing claims", async () => {
    const fixture = await brokerFixture(() => ({ tasks: () => tasks }));
    try {
      await fixture.register("one");
      fixture.broker.syncNow = async () => {};
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts"];
      session.pending.push("unheard note");
      const before = JSON.stringify(fixture.broker.snapshot());
      const rows: ReadonlyArray<readonly [string, string[], "usage" | "refused", string]> = [
        ["claim", [], "usage", "peer claim"],
        ["claim", ["/outside/checkout"], "usage", "peer claim"],
        ["index", ["0"], "usage", "peer index"],
        ["release", ["--typo"], "usage", "peer release"],
        ["claim", ["pay.ts", "--intent"], "usage", "peer claim"],
        ["log", [], "refused", "update"],
      ];
      for (const [command, args, outcome, next] of rows) {
        await expect(fixture.broker.runCli(command, args, headers)).rejects.toMatchObject({
          outcome,
          next: expect.stringContaining(next),
        });
        expect(JSON.stringify(fixture.broker.snapshot())).toBe(before);
        expect(session.claims).toEqual(["pay.ts"]);
        expect(session.pending).toEqual(["unheard note"]);
      }
    } finally {
      await fixture.dispose();
    }
  });

  it("makes a failed log read a refusal with a retry step", async () => {
    for (const failure of [
      new Error("offline"),
      new PeerHubError({ detail: "denied", refused: true }),
    ]) {
      const fixture = await brokerFixture(() => ({
        coordEvents: async (): Promise<never> => {
          throw failure;
        },
      }));
      try {
        await fixture.register("one");
        await expect(fixture.broker.runCli("log", [], headers)).rejects.toMatchObject({
          outcome: "refused",
          reason: failure.message,
          next: expect.stringContaining("again"),
        });
      } finally {
        await fixture.dispose();
      }
    }
  });

  it("reports held paths and the caller's current task state", async () => {
    const fixture = await brokerFixture(() => ({
      tasks: () => tasks,
      taskOf: () => "other",
      taskName: () => "KRK-7 · Other work",
    }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts"];
      const text = await fixture.broker.runCli("status", [], headers);
      expect(text).toContain("You hold: pay.ts.");
      expect(text).toContain("Your task KRK-7 · Other work is review.");
    } finally {
      await fixture.dispose();
    }
  });
});
