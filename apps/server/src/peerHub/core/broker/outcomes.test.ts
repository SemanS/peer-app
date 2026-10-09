// @effect-diagnostics globalDate:off - a broker on a temporary checkout.
import { PeerHubError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import type { HubOverlap } from "../hub/coordApi.ts";
import { brokerFixture } from "./testkit.ts";

const headers = { "x-peer-session": "one" };
const context = {
  project: "app",
  scope: "task:other",
  version: 2,
  text: "exact shared input",
  updatedAt: "2026-10-09T12:00:00Z",
};
const overlap: HubOverlap = {
  id: "overlap",
  project: "app",
  sessions: ["claude:one", "claude:other"],
  files: ["pay.ts"],
  state: "open",
  notes: [],
  openedAt: context.updatedAt,
  updatedAt: context.updatedAt,
};
const tasks = [{ id: "other", key: "KRK-7", title: "Other work", status: "review" }];

describe("peer command outcomes", () => {
  it("rejects invalid arguments and local refusals without changing claims, notes or reads", async () => {
    const fixture = await brokerFixture(() => ({ tasks: () => tasks }));
    try {
      await fixture.register("one");
      fixture.broker.syncNow = async () => {};
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts"];
      session.pending.push("unheard note");
      const before = JSON.stringify(fixture.broker.snapshot());
      const rows: ReadonlyArray<readonly [string, string[], "usage" | "refused", string]> = [
        ["note", [], "usage", "peer note"],
        ["resolve", [], "usage", "peer resolve"],
        ["claim", [], "usage", "peer claim"],
        ["claim", ["/outside/checkout"], "usage", "peer claim"],
        ["context", ["missing"], "usage", "peer context"],
        ["context", ["KRK-7", "nan"], "usage", "peer context"],
        ["context", ["KRK-7", "1"], "usage", "peer context history"],
        ["ack", [], "usage", "peer ack"],
        ["index", ["0"], "usage", "peer index"],
        ["release", ["--typo"], "usage", "peer release"],
        ["claim", ["pay.ts", "--intent"], "usage", "peer claim"],
        ["note", ["hello"], "refused", "peer status"],
        ["resolve", ["agreed"], "refused", "peer status"],
        ["review", [], "refused", "assign"],
        ["done", [], "refused", "assign"],
        ["ack", ["KRK-7"], "refused", "peer context"],
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
        expect(session.read.size).toBe(0);
      }
    } finally {
      await fixture.dispose();
    }
  });

  it("classifies each write failure and never acknowledges an uncertain note or context read", async () => {
    const failures = [
      new PeerHubError({ detail: "Hub refused the command", refused: true }),
      new PeerHubError({ detail: "Connection lost" }),
      new Error("Connection lost"),
      new PeerHubError({ detail: "Sign in first.", refused: true }),
      new PeerHubError({
        detail: "Your session with the hub ended. Sign in again.",
        refused: true,
      }),
    ];
    for (const failure of failures) {
      const fail = async (): Promise<never> => {
        throw failure;
      };
      const fixture = await brokerFixture(() => ({
        tasks: () => tasks,
        taskOf: () => "other",
        readContext: async () => context,
        note: fail,
        resolve: fail,
        contextRead: fail,
        finishTask: fail,
      }));
      try {
        await fixture.register("one");
        fixture.broker.syncNow = async () => {};
        fixture.broker.views.set("acme", {
          sessions: [],
          overlaps: [overlap],
          at: context.updatedAt,
        });
        const session = fixture.broker.sessions.get("claude:one")!;
        const outcome = "refused" in failure && failure.refused ? "refused" : "uncertain";
        for (const [command, args] of [
          ["note", ["hello"]],
          ["resolve", ["agreed"]],
          ["ack", ["KRK-7"]],
          ["context", []],
          ["review", []],
          ["done", []],
        ] as const) {
          await expect(fixture.broker.runCli(command, args, headers)).rejects.toMatchObject({
            outcome,
            next: expect.stringContaining(
              failure.message.includes("Sign in") || failure.message.includes("Sign in again")
                ? "sign in"
                : outcome === "uncertain" && command !== "context"
                  ? "peer status"
                  : command === "context"
                    ? "peer context again"
                    : "",
            ),
          });
          expect(session.memory.acknowledged.size).toBe(0);
          expect(session.read.size).toBe(0);
          expect(fixture.broker.views.get("acme")?.overlaps[0]).toEqual(overlap);
        }
      } finally {
        await fixture.dispose();
      }
    }
  });

  it("makes failed context/history/version/log reads refusals with a retry step", async () => {
    for (const failure of [
      new Error("offline"),
      new PeerHubError({ detail: "denied", refused: true }),
    ]) {
      const fail = async (): Promise<never> => {
        throw failure;
      };
      const fixture = await brokerFixture(() => ({
        tasks: () => tasks,
        readContext: fail,
        contextVersions: fail,
        readContextVersion: fail,
        coordEvents: fail,
      }));
      try {
        await fixture.register("one");
        fixture.broker.syncNow = async () => {};
        for (const [command, args] of [
          ["context", []],
          ["context", ["history"]],
          ["context", ["1"]],
          ["ack", ["KRK-7"]],
          ["log", []],
        ] as const) {
          await expect(fixture.broker.runCli(command, args, headers)).rejects.toMatchObject({
            outcome: "refused",
            reason: failure.message,
            next: expect.stringContaining("again"),
          });
        }
        expect(fixture.broker.sessions.get("claude:one")?.read.size).toBe(0);
      } finally {
        await fixture.dispose();
      }
    }
  });

  it("reports held paths, asked tasks and the caller's current task state", async () => {
    const fixture = await brokerFixture(() => ({
      tasks: () => tasks,
      taskOf: () => "other",
      taskName: () => "KRK-7 · Other work",
    }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts", "task:other"];
      const text = await fixture.broker.runCli("status", [], headers);
      expect(text).toContain("You hold: pay.ts, asked KRK-7 · Other work.");
      expect(text).toContain("Your task KRK-7 · Other work is review.");
    } finally {
      await fixture.dispose();
    }
  });
});
