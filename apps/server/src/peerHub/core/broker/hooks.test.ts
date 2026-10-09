// @effect-diagnostics nodeBuiltinImport:off globalDate:off - broker fixtures in a temporary checkout, and its log.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { brokerFixture } from "./testkit.ts";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("the broker's hooks", () => {
  it("delivers startup guidance before a slow hub finishes, then queues the complete context", async () => {
    const fixture = await brokerFixture();
    const completed = Promise.withResolvers<Record<string, unknown>>();
    const entered = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    try {
      await fixture.register("slow");
      const originalLog = fixture.broker["log"].bind(fixture.broker);
      fixture.broker["log"] = (event, data) => {
        originalLog(event, data);
        if (event === "hook.late") queued.resolve();
      };
      fixture.broker["answerHook"] = async () => {
        entered.resolve();
        return completed.promise;
      };
      vi.useFakeTimers();
      const response = fixture.broker["hookInTime"](
        {
          session_id: "slow",
          cwd: fixture.root,
          hook_event_name: "SessionStart",
        },
        {},
      );
      await entered.promise;
      await vi.advanceTimersByTimeAsync(3300);
      const answer = await response;
      expect(answer?.hookSpecificOutput).toMatchObject({ hookEventName: "SessionStart" });
      expect(JSON.stringify(answer)).toContain("still connecting");
      expect(JSON.stringify(answer)).toContain(fixture.broker["scripts"].peer);
      completed.resolve({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: "Fresh shared context",
        },
      });
      await queued.promise;
      expect(fixture.broker["sessions"].get("claude:slow")?.pending).toContain(
        "Fresh shared context",
      );
    } finally {
      vi.useRealTimers();
      completed.resolve({});
      await fixture.dispose();
    }
  });

  it("rotates a resumed session without SessionEnd while compact and the settings copy preserve its generation", async () => {
    const fixture = await brokerFixture();
    const post = (path: string, body: Record<string, unknown>, mod = true) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = NodeHttp.request(
          {
            socketPath: NodePath.join(fixture.root, "peer.sock"),
            path,
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(mod ? { "x-peer-adapter": "mod" } : {}),
            },
          },
          (response) => {
            let text = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              text += chunk;
            });
            response.on("error", reject);
            response.on("end", () => resolve({ status: response.statusCode!, text }));
          },
        );
        request.on("error", reject);
        request.end(JSON.stringify(body));
      });
    const start = Promise.withResolvers<string>();
    const starting = Promise.withResolvers<void>();
    try {
      await fixture.register("one");
      await fixture.broker.start();
      const session = fixture.broker["sessions"].get("claude:one")!;
      session.task = "prices";
      session.claims = ["area:pricing"];
      session.read.set("task:other", {
        version: 4,
        text: "An interface",
        notifiedVersion: 4,
        toldAt: Date.now(),
      });
      const original = fixture.broker["answerHook"];
      fixture.broker["answerHook"] = async () => ({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "Old runtime context",
        },
      });
      const prepared = await post("/hook", {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "UserPromptSubmit",
      });
      const oldDelivery = (JSON.parse(prepared.text) as { peerDelivery: { id: string } })
        .peerDelivery.id;
      fixture.broker["answerHook"] = original;
      fixture.broker["startContextFor"] = async () => {
        starting.resolve();
        return start.promise;
      };
      session.modHandled.set("obsolete", Date.now());
      const previous = session.runtimeGeneration;
      const body = {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "SessionStart",
        source: "resume",
      };
      const resumed = post("/hook", body);
      await starting.promise;
      expect(session.runtimeGeneration).not.toBe(previous);
      const generation = session.runtimeGeneration;
      expect(session.modHandled.has("obsolete")).toBe(false);
      expect(session.read.get("task:other")?.version).toBe(4);
      expect(session.task).toBe("prices");
      expect(session.claims).toEqual(["area:pricing"]);
      expect(fixture.broker.coordinationLevel("claude:one")).toBe("A");
      expect(
        (await post("/delivery", { session_id: "one", id: oldDelivery, evidence: "model-input" }))
          .status,
      ).toBe(400);
      expect((await post("/hook", body, false)).status).toBe(204);
      expect(session.runtimeGeneration).toBe(generation);
      start.resolve("Resumed runtime context");
      const resumedDelivery = (JSON.parse((await resumed).text) as { peerDelivery: { id: string } })
        .peerDelivery.id;
      fixture.broker["startContextFor"] = async () => "Compacted context";
      await post("/hook", { ...body, source: "compact" });
      expect(session.runtimeGeneration).toBe(generation);
      expect(fixture.broker.coordinationLevel("claude:one")).toBe("A");
      expect(
        (
          await post("/delivery", {
            session_id: "one",
            id: resumedDelivery,
            evidence: "model-input",
          })
        ).status,
      ).toBe(204);
      await post("/hook", { ...body, source: "startup" }, false);
      expect(session.runtimeGeneration).not.toBe(generation);
      expect(session.deliveries.size).toBe(0);
      expect(fixture.broker.coordinationLevel("claude:one")).toBe("B");
    } finally {
      start.resolve("Resumed runtime context");
      await fixture.dispose();
    }
  });

  it("does not prepare an old in-flight Mod reply after its runtime was resumed", async () => {
    const fixture = await brokerFixture();
    const entered = Promise.withResolvers<void>();
    const reply = Promise.withResolvers<Record<string, unknown> | null>();
    try {
      await fixture.register("one");
      const original = fixture.broker["answerHook"];
      fixture.broker["startContextFor"] = async () => "New runtime context";
      fixture.broker["answerHook"] = async (event, session, body, adapter) => {
        if (event === "UserPromptSubmit") {
          entered.resolve();
          return reply.promise;
        }
        return original.call(fixture.broker, event, session, body, adapter);
      };
      const body = { session_id: "one", cwd: fixture.root, hook_event_name: "UserPromptSubmit" };
      const pending = fixture.broker["hook"](body, { "x-peer-adapter": "mod" });
      await entered.promise;
      await fixture.broker["hook"](
        { ...body, hook_event_name: "SessionStart", source: "resume" },
        { "x-peer-adapter": "mod" },
      );
      reply.resolve({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "Old reply" },
      });
      expect(await pending).toBeNull();
      const session = fixture.broker["sessions"].get("claude:one")!;
      expect([...session.deliveries.values()].map((delivery) => delivery.text)).toEqual([
        "New runtime context",
      ]);
    } finally {
      reply.resolve(null);
      await fixture.dispose();
    }
  });

  it.each([
    { tool_name: "Edit", tool_input: { file_path: "src/pricing.ts" } },
    { tool_name: "Bash", tool_input: { command: "git push" } },
  ])("blocks an in-flight $tool_name action from a replaced runtime", async (tool) => {
    const fixture = await brokerFixture();
    const entered = Promise.withResolvers<void>();
    const reply = Promise.withResolvers<Record<string, unknown> | null>();
    try {
      await fixture.register("one");
      const original = fixture.broker["answerHook"];
      fixture.broker["startContextFor"] = async () => "New runtime context";
      fixture.broker["answerHook"] = async (event, session, body, adapter) => {
        if (event === "PreToolUse") {
          entered.resolve();
          return reply.promise;
        }
        return original.call(fixture.broker, event, session, body, adapter);
      };
      const body = { session_id: "one", cwd: fixture.root, hook_event_name: "PreToolUse", ...tool };
      const pending = fixture.broker["hook"](body, { "x-peer-adapter": "mod" });
      await entered.promise;
      await fixture.broker["hook"](
        { session_id: "one", cwd: fixture.root, hook_event_name: "SessionStart", source: "resume" },
        { "x-peer-adapter": "mod" },
      );
      reply.resolve({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
      });
      expect(await pending).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    } finally {
      reply.resolve(null);
      await fixture.dispose();
    }
  });

  it("applies each policy at the broker deadline and always blocks unverified publication", async () => {
    const fixture = await brokerFixture(() => ({ policy: () => "notify" }));
    try {
      await fixture.register("one");
      fixture.broker["answerHook"] = () => new Promise(() => {});
      vi.useFakeTimers();
      const body = {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "price.ts" },
      };
      for (const policy of ["notify", "ask", "coordinate", "exclusive"] as const) {
        fixture.broker["views"].set("acme", {
          sessions: [],
          overlaps: [],
          at: new Date().toISOString(),
          policies: { app: policy },
        });
        const pending = fixture.broker["hookInTime"](body, {});
        await vi.advanceTimersByTimeAsync(4000);
        const result = await pending;
        if (policy === "notify") expect(result).toBeNull();
        else
          expect(result?.hookSpecificOutput).toMatchObject({
            permissionDecision: policy === "ask" ? "ask" : "deny",
          });
      }
      const publish = fixture.broker["hookInTime"](
        { ...body, tool_name: "Bash", tool_input: { command: "git push origin HEAD" } },
        {},
      );
      await vi.advanceTimersByTimeAsync(4000);
      expect((await publish)?.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
      const read = fixture.broker["hookInTime"](
        { ...body, tool_name: "Bash", tool_input: { command: "git status" } },
        {},
      );
      await vi.advanceTimersByTimeAsync(4000);
      expect(await read).toBeNull();
    } finally {
      vi.useRealTimers();
      await fixture.dispose();
    }
  });

  it("suppresses only the matching settings hook after a Mod handled the event", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      const body = {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "Notification",
        message: "permission needed",
      };
      expect(fixture.broker.coordinationLevel("claude:one")).toBe("B");
      const mod = await fixture.broker["hook"](body, { "x-peer-adapter": "mod" });
      expect(mod?.peerStatus).toBeDefined();
      expect(fixture.broker.coordinationLevel("claude:one")).toBe("A");
      expect(await fixture.broker["hook"](body, {})).toBeNull();
      await fixture.broker["hook"]({ ...body, message: "another approval" }, {});
      await fixture.broker["logQueue"];
      const log = await NodeFSP.readFile(NodePath.join(fixture.root, "broker.jsonl"), "utf8");
      expect(log.split("\n").filter((line) => line.includes('"event":"hook"'))).toHaveLength(2);
    } finally {
      await fixture.dispose();
    }
  });

  it("blocks handoff on stale reads and when freshness cannot be verified", async () => {
    const stale = { current: true };
    const fixture = await brokerFixture(() => ({
      staleReads: async () => {
        if (!stale.current) throw new Error("offline");
        return {
          fresh: false,
          stale: [
            {
              project: "app",
              scope: "task:prices",
              readVersion: 1,
              currentVersion: 2,
              at: "2026-10-06",
              updatedAt: "2026-10-06",
            },
          ],
        };
      },
    }));
    try {
      await fixture.register("one");
      const body = {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git push origin HEAD" },
      };
      const blocked = await fixture.broker["hook"](body, {});
      expect(blocked?.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
      expect(JSON.stringify(blocked)).toContain("prices");
      stale.current = false;
      expect((await fixture.broker["hook"](body, {}))?.hookSpecificOutput).toMatchObject({
        permissionDecision: "deny",
      });
      expect(
        await fixture.broker["hook"](
          { ...body, tool_input: { command: 'echo "git push origin HEAD"' } },
          {},
        ),
      ).toBeNull();
    } finally {
      await fixture.dispose();
    }
  });
});
