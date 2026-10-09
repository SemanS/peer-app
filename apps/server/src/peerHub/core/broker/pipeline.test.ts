// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the broker's socket and log in a temporary checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import type { PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import type { HubOverlap } from "../hub/coordApi.ts";
import type { PeerContributions } from "../plugin.ts";
import type { ActivePlugin } from "../plugins/PeerPlugins.ts";
import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { NOTICE_MAX } from "./pipeline.ts";
import { brokerFixture } from "./testkit.ts";

afterEach(() => {
  vi.useRealTimers();
});

const plugin = (id: PeerPluginId, contributions: PeerContributions): ActivePlugin => ({
  id,
  title: id,
  contributions,
});
const only = (...active: ReadonlyArray<ActivePlugin>): PeerBrokerPlugins => ({
  ...NO_PLUGINS,
  active,
});

/** What a hook's answer adds to the agent's context. */
const added = (out: Record<string, unknown> | null) =>
  ((out?.hookSpecificOutput as { readonly additionalContext?: string } | undefined)
    ?.additionalContext ?? "") as string;
const decision = (out: Record<string, unknown> | null) =>
  (out?.hookSpecificOutput ?? {}) as {
    readonly permissionDecision?: string;
    readonly permissionDecisionReason?: string;
  };

/** The broker's log so far. */
const logged = async (fixture: Awaited<ReturnType<typeof brokerFixture>>) => {
  await fixture.broker["logQueue"];
  return (await NodeFSP.readFile(NodePath.join(fixture.root, "broker.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(
      (line) => JSON.parse(line) as { readonly event: string; readonly [field: string]: unknown },
    );
};

/** Lets the promises already in flight finish (a macrotask passes). */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A plugin that says something at every step it can. */
const chatty = plugin("knowledge", {
  commands: [
    {
      name: "lore",
      usage: "lore",
      summary: "the project's lore",
      run: () => Effect.succeed("lore"),
    },
  ],
  hooks: {
    sessionStart: () => Effect.succeed("Lore: keep prices in cents."),
    notices: [{ wakes: false, read: () => Effect.succeed("Lore applies to your change.") }],
    postTool: (ctx) => Effect.succeed(`Lore read ${ctx.paths.join(", ")}.`),
    preCompact: () => Effect.succeed("Lore survives compaction."),
  },
});

describe("what plugins add to hook answers", () => {
  it("adds an active plugin's text after core's at every step, and none while it is inactive", async () => {
    const on = { current: false };
    const fixture = await brokerFixture(() => ({
      plugins: async () => (on.current ? only(chatty) : NO_PLUGINS),
    }));
    try {
      const steps = async (id: string) => {
        const body = { session_id: id, cwd: fixture.root };
        return [
          added(await fixture.broker["hook"]({ ...body, hook_event_name: "SessionStart" }, {})),
          added(
            await fixture.broker["hook"](
              { ...body, hook_event_name: "UserPromptSubmit", prompt: "Format the prices." },
              {},
            ),
          ),
          added(
            await fixture.broker["hook"](
              {
                ...body,
                hook_event_name: "PostToolUse",
                tool_name: "Edit",
                tool_input: { file_path: NodePath.join(fixture.root, "src/price.ts") },
              },
              {},
            ),
          ),
          added(await fixture.broker["hook"]({ ...body, hook_event_name: "PreCompact" }, {})),
        ] as const;
      };
      const quiet = await steps("quiet-session");
      expect(quiet.join("\n")).not.toContain("Lore");

      on.current = true;
      const [start, prompt, post, compact] = await steps("loud-session");
      expect(start).toMatch(/[^]+\n\nLore: keep prices in cents\.$/);
      expect(prompt).toContain("Lore applies to your change.");
      expect(post).toContain("Lore applies to your change.\n\nLore read src/price.ts.");
      expect(compact).toBe("Lore survives compaction.");
      // Core's own start text comes first, the plugin's block after it.
      expect(start.startsWith("You are Ana's agent here.")).toBe(true);
      expect(quiet[0].startsWith("You are Ana's agent here.")).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  it("tells of a note on an overlap before any plugin's notice", async () => {
    const fixture = await brokerFixture(() => ({ plugins: async () => only(chatty) }));
    try {
      await fixture.register("one");
      const now = new Date().toISOString();
      const overlap: HubOverlap = {
        id: "abc123def456",
        project: "app",
        sessions: ["claude:one", "claude:vir"],
        files: ["src/pay.ts"],
        state: "open",
        notes: [
          {
            id: "n1",
            session: "claude:vir",
            email: "vir@acme.test",
            text: "I rename pay() first",
            at: now,
          },
        ],
        openedAt: now,
        updatedAt: now,
      };
      fixture.broker["views"].set("acme", { sessions: [], overlaps: [overlap], at: now });
      const text = added(
        await fixture.broker["hook"](
          {
            session_id: "one",
            cwd: fixture.root,
            hook_event_name: "UserPromptSubmit",
            prompt: "Go on.",
          },
          {},
        ),
      );
      expect(text).toContain("I rename pay() first");
      expect(text.indexOf("I rename pay() first")).toBeLessThan(
        text.indexOf("Lore applies to your change."),
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("cuts a long notice to its bound, ending with the command that shows the rest", async () => {
    const long = `LORE ${"x".repeat(2995)}`;
    const fixture = await brokerFixture(() => ({
      plugins: async () =>
        only(
          plugin("knowledge", {
            ...chatty.contributions,
            hooks: { notices: [{ wakes: false, read: () => Effect.succeed(long) }] },
          }),
        ),
    }));
    try {
      await fixture.register("one");
      const text = added(
        await fixture.broker["hook"](
          {
            session_id: "one",
            cwd: fixture.root,
            hook_event_name: "UserPromptSubmit",
            prompt: "Go.",
          },
          {},
        ),
      );
      const theirs = text.slice(text.indexOf("LORE"));
      expect(long).toHaveLength(3000);
      expect(theirs.length).toBeLessThanOrEqual(NOTICE_MAX);
      expect(theirs.length).toBeGreaterThan(NOTICE_MAX - 5);
      expect(theirs.endsWith("… (`peer lore` shows the rest)")).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  it("answers on time without a slow notice, which reaches the agent at its next step", async () => {
    const ready = Promise.withResolvers<void>();
    let reads = 0;
    const slow = plugin("ask", {
      hooks: {
        notices: [
          {
            wakes: false,
            read: () =>
              (reads += 1) === 1
                ? Effect.promise(() => ready.promise).pipe(Effect.as("Late plugin news"))
                : Effect.succeed(null),
          },
        ],
      },
    });
    const fixture = await brokerFixture(() => ({ plugins: async () => only(slow) }));
    try {
      await fixture.register("one");
      const session = fixture.broker["sessions"].get("claude:one")!;
      const body = { session_id: "one", cwd: fixture.root };
      // A hook due in 400 ms: plugins' text has until 100 ms.
      const first = await fixture.broker["answerHook"](
        "UserPromptSubmit",
        session,
        { ...body, hook_event_name: "UserPromptSubmit", prompt: "Go." },
        { mod: false, signature: "", plugins: only(slow), due: Date.now() + 400 },
      );
      expect(added(first)).not.toContain("Late plugin news");
      ready.resolve();
      await settled();
      expect(session.pending).toContain("Late plugin news");
      const next = await fixture.broker["hook"](
        {
          ...body,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        {},
      );
      expect(added(next)).toContain("Late plugin news");
      expect((await logged(fixture)).some((line) => line.event === "plugin.late")).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });
});

describe("waking an idle agent", () => {
  it("uses only the notices it must answer", async () => {
    const asking = plugin("ask", {
      hooks: {
        notices: [
          { wakes: true, read: () => Effect.succeed("Vir's agent asks where you keep the names.") },
          { wakes: false, read: () => Effect.succeed("A context you read changed.") },
        ],
      },
    });
    const fixture = await brokerFixture(() => ({ plugins: async () => only(asking) }));
    try {
      await fixture.register("one");
      const woken = await fixture.broker["wait"]({ session_id: "one", cwd: fixture.root }, {});
      expect(woken).toBe("Vir's agent asks where you keep the names.");
    } finally {
      await fixture.dispose();
    }
  });
});

describe("a Codex permission request", () => {
  it("lets through the files an active plugin keeps for the session, and nothing else", async () => {
    const fixture = await brokerFixture((host) => ({
      plugins: async () =>
        only(
          plugin("memory", {
            hooks: {
              ownPaths: (session) => [NodePath.join(host.contextsDir, `${session.id}.notes`)],
            },
          }),
        ),
    }));
    try {
      const request = (file: string) =>
        fixture.broker["hook"](
          {
            hook_event_name: "PermissionRequest",
            session_id: "one",
            cwd: fixture.root,
            tool_name: "Edit",
            tool_input: { file_path: file },
          },
          { "x-peer-agent": "codex" },
        );
      expect(await request(NodePath.join(fixture.root, "contexts", "codex:one.notes"))).toEqual({
        hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
      });
      expect(await request(NodePath.join(fixture.root, "src", "pay.ts"))).toBeNull();
    } finally {
      await fixture.dispose();
    }
  });
});

describe("plugins' verdicts on tool calls", () => {
  const editOf = (root: string, id: string, file: string) => ({
    hook_event_name: "PreToolUse",
    session_id: id,
    cwd: root,
    tool_name: "Edit",
    tool_input: { file_path: NodePath.join(root, file), old_string: "a", new_string: "b" },
  });

  it("stops an edit a plugin denies before the hub hears of it", async () => {
    let asked = 0;
    const guard = plugin("find", {
      hooks: {
        preTool: {
          on: "edits",
          decide: (ctx) =>
            Effect.succeed(
              ctx.paths.some((path) => path.startsWith("migrations/"))
                ? { decision: "deny", reason: "Migrations need a DBA's review." }
                : null,
            ),
          fallback: () => null,
        },
      },
    });
    const fixture = await brokerFixture(() => ({
      plugins: async () => only(guard),
      intent: async (_workspace, _project, request) => {
        asked += 1;
        return {
          policy: "coordinate",
          policySource: "client",
          verdicts: request.paths.map((path) => ({
            path,
            verdict: "clear",
            with: [],
            overlaps: [],
          })),
          overlaps: [],
          at: new Date().toISOString(),
        };
      },
    }));
    try {
      const denied = decision(
        await fixture.broker["hook"](editOf(fixture.root, "one", "migrations/001.sql"), {}),
      );
      expect(denied).toMatchObject({
        permissionDecision: "deny",
        permissionDecisionReason: "Migrations need a DBA's review.",
      });
      expect(asked).toBe(0);
      expect(fixture.broker["sessions"].get("claude:one")?.claims).toEqual([]);
      // An edit the plugin lets through goes to the hub as before.
      expect(
        decision(await fixture.broker["hook"](editOf(fixture.root, "one", "src/pay.ts"), {}))
          .permissionDecision,
      ).toBeUndefined();
      expect(asked).toBe(1);
    } finally {
      await fixture.dispose();
    }
  });

  it("applies a plugin's fallback when it misses its budget, logs it, and still asks the hub", async () => {
    let asked = 0;
    const slow = plugin("find", {
      hooks: {
        preTool: {
          on: "all",
          decide: () => Effect.never,
          fallback: () => ({ decision: "ask", reason: "Ops could not check this edit in time." }),
        },
      },
    });
    const fixture = await brokerFixture(() => ({
      plugins: async () => only(slow),
      intent: async (_workspace, _project, request) => {
        asked += 1;
        return {
          policy: "coordinate",
          policySource: "client",
          verdicts: request.paths.map((path) => ({
            path,
            verdict: "clear",
            with: [],
            overlaps: [],
          })),
          overlaps: [],
          at: new Date().toISOString(),
        };
      },
    }));
    try {
      // The session is known to the hub: only the plugin is left to wait for.
      await fixture.broker["sessionFor"](
        "claude",
        { session_id: "one", cwd: fixture.root },
        undefined,
      );
      await fixture.broker["sync"]("acme");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const pending = fixture.broker["hook"](editOf(fixture.root, "one", "src/pay.ts"), {});
      await vi.advanceTimersByTimeAsync(1000);
      const out = decision(await pending);
      vi.useRealTimers();
      expect(out).toMatchObject({
        permissionDecision: "ask",
        permissionDecisionReason: "Ops could not check this edit in time.",
      });
      expect(asked).toBe(1);
      expect(
        (await logged(fixture)).find((line) => line.event === "plugin.verdict.fallback"),
      ).toMatchObject({
        plugin: "find",
        session: "claude:one",
        paths: ["src/pay.ts"],
        reason: "budget",
        verdict: "ask",
      });
    } finally {
      vi.useRealTimers();
      await fixture.dispose();
    }
  });
});

describe("delivery receipts", () => {
  it("count a plugin's characters in what a Peer Mod session received", async () => {
    const fixture = await brokerFixture(() => ({ plugins: async () => only(chatty) }));
    const post = (path: string, body: Record<string, unknown>) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = NodeHttp.request(
          {
            socketPath: NodePath.join(fixture.root, "peer.sock"),
            path,
            method: "POST",
            headers: { "content-type": "application/json", "x-peer-adapter": "mod" },
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
    try {
      await fixture.register("one");
      await fixture.broker.start();
      const prepared = await post("/hook", {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "UserPromptSubmit",
        prompt: "Format the prices.",
      });
      const delivery = (
        JSON.parse(prepared.text) as { peerDelivery: { id: string; text: string; chars: number } }
      ).peerDelivery;
      expect(delivery.text).toContain("Lore applies to your change.");
      expect(
        (await post("/delivery", { session_id: "one", id: delivery.id, evidence: "model-input" }))
          .status,
      ).toBe(204);
      expect(fixture.broker["sessions"].get("claude:one")?.injected.get("UserPromptSubmit")).toBe(
        delivery.text.length,
      );
    } finally {
      await fixture.dispose();
    }
  });
});
