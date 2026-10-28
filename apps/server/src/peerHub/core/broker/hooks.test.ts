// @effect-diagnostics nodeBuiltinImport:off globalDate:off - broker fixtures in a temporary checkout, and its log.
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import { NO_PLUGINS } from "./host.ts";
import { brokerFixture, placesOfState } from "./testkit.ts";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

/** A fresh clone named `name` of `origin`, with a `src` folder, in its own temporary directory. */
async function clone(name: string, origin: string) {
  const dir = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-clone-")),
  );
  const root = NodePath.join(dir, name);
  await NodeFSP.mkdir(NodePath.join(root, "src"), { recursive: true });
  NodeChildProcess.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  NodeChildProcess.execFileSync("git", ["remote", "add", "origin", origin], { cwd: root });
  return root;
}

describe("the broker's hooks", () => {
  it("a_session_in_a_remote_bound_clone_is_coordinated", async () => {
    // Core's own PeerState places folders and keeps their notices: app's repository is one
    // project's, pay's is two projects'.
    const places = await placesOfState([
      ["app", "git@github.com:acme/app.git"],
      ["web", "git@github.com:acme/web.git"],
      ["pay", "git@github.com:acme/pay.git"],
      ["pay-eu", "git@github.com:acme/pay.git"],
    ]);
    const app = await clone("app", "https://github.com/acme/app");
    const pay = await clone("pay", "git@github.com:acme/pay.git");
    const web = await clone("web", "git@github.com:acme/web.git");
    const fixture = await brokerFixture(() => ({ taskOf: () => "vl-7", ...places }));
    try {
      const start = async (id: string, cwd: string) =>
        (
          (
            await fixture.broker["hook"](
              { session_id: id, cwd, hook_event_name: "SessionStart" },
              { "x-peer-agent": "claude" },
            )
          )?.hookSpecificOutput as { readonly additionalContext?: string } | undefined
        )?.additionalContext ?? "";
      // A clone of two projects' repository is coordinated nowhere, and its session hears how to
      // choose; the notice stays that folder's.
      const unplaced = await start("two", NodePath.join(pay, "src"));
      expect(unplaced).toContain("acme/pay, acme/pay-eu");
      expect(unplaced).toContain("peer core bind . --project <workspace/project>");
      expect(fixture.broker["sessions"].has("claude:two")).toBe(false);

      const first = await start("bound", app);
      expect(first.startsWith(`Peer: Bound ${app} to acme/app.\n\n`)).toBe(true);
      expect(first).not.toContain("pay-eu");
      // The clone is coordinated as any bound checkout: its project and task, as always.
      expect(fixture.broker["sessions"].get("claude:bound")).toMatchObject({
        workspace: "acme",
        project: "app",
        task: "vl-7",
      });
      expect(first).toContain("You are Ana's agent here.");
      // Said once: the next session in the same clone hears no notice.
      expect(await start("again", app)).not.toContain("Bound");

      // An MCP client in another freshly bound clone hears it with its first tool's answer.
      const session = await fixture.broker.bindTools({ server: "editor-1", cwd: web });
      const reply = await fixture.broker.callTools(session.id, "status", [], true);
      expect(reply.text).toContain(`Peer: Bound ${web} to acme/web.`);
      const later = await fixture.broker.callTools(session.id, "status", [], false);
      expect(later.text).not.toContain(`Bound ${web}`);
    } finally {
      await fixture.dispose();
      for (const folder of [app, pay, web])
        await NodeFSP.rm(NodePath.dirname(folder), { recursive: true, force: true });
    }
  });

  it("keeps slow plugin discovery within the hook deadline and refuses unverified tools", async () => {
    const plugins = Promise.withResolvers<typeof NO_PLUGINS>();
    const slow = { current: true };
    const fixture = await brokerFixture(() => ({
      plugins: () => (slow.current ? plugins.promise : Promise.resolve(NO_PLUGINS)),
    }));
    try {
      vi.useFakeTimers();
      const pending = fixture.broker["hookInTime"](
        {
          session_id: "slow-plugins",
          cwd: fixture.root,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "git push" },
        },
        { "x-peer-agent": "codex" },
      );
      let answered = false;
      void pending.then(() => {
        answered = true;
      });
      await vi.advanceTimersByTimeAsync(3300);
      expect(answered).toBe(true);
      expect((await pending)?.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
    } finally {
      vi.useRealTimers();
      slow.current = false;
      await fixture.dispose();
    }
  });

  it("rewrites Peer commands to an executable path containing spaces and apostrophes", async () => {
    const fixture = await brokerFixture((host) => ({
      scriptsDir: NodePath.join(host.scriptsDir, "Peer's tools"),
    }));
    try {
      const script = fixture.broker.scripts.peer;
      await NodeFSP.mkdir(NodePath.dirname(script), { recursive: true });
      await NodeFSP.writeFile(script, '#!/bin/sh\nprintf "%s" "$1"\n', { mode: 0o700 });
      const body = {
        session_id: "quoted",
        cwd: fixture.root,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
      };
      const headers = { "x-peer-agent": "codex" };
      const answer = await fixture.broker["hook"](
        { ...body, tool_input: { command: "peer status" } },
        headers,
      );
      const output = answer?.hookSpecificOutput as { updatedInput: { command: string } };
      const result = await new Promise<string>((resolve, reject) => {
        NodeChildProcess.execFile(
          "/bin/sh",
          ["-c", output.updatedInput.command],
          (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
        );
      });
      expect(result).toBe("status");
      const permission = await fixture.broker["hook"](
        {
          ...body,
          hook_event_name: "PermissionRequest",
          tool_input: { command: output.updatedInput.command },
        },
        headers,
      );
      expect(permission?.hookSpecificOutput).toMatchObject({ decision: { behavior: "allow" } });
    } finally {
      await fixture.dispose();
    }
  });

  it("makes an interrupted Codex session idle and records its shell edits without ending it", async () => {
    let status = "";
    const fixture = await brokerFixture(() => ({ gitStatus: async () => status }));
    try {
      const body = { session_id: "interrupted", cwd: fixture.root };
      const headers = { "x-peer-agent": "codex" };
      await fixture.broker["hook"]({ ...body, hook_event_name: "UserPromptSubmit" }, headers);
      status = " M price.ts\0";
      expect(
        await fixture.broker["hook"]({ ...body, hook_event_name: "Interrupt" }, headers),
      ).toBeNull();
      const session = fixture.broker["sessions"].get("codex:interrupted")!;
      expect(session.status).toBe("idle");
      expect(session.files).toContain("price.ts");
      await fixture.broker["hook"](
        { ...body, session_id: "unknown", hook_event_name: "Interrupt" },
        headers,
      );
      expect(fixture.broker["sessions"].has("codex:unknown")).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });

  it("delivers Codex pre-compaction plugin context exactly once through compact SessionStart", async () => {
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [
          {
            id: "knowledge",
            title: "Knowledge",
            contributions: {
              hooks: { preCompact: () => Effect.succeed("Keep the price invariant.") },
            },
          },
        ],
      }),
    }));
    try {
      const body = { session_id: "compact", cwd: fixture.root };
      const headers = { "x-peer-agent": "codex" };
      await fixture.broker["hook"]({ ...body, hook_event_name: "SessionStart" }, headers);
      expect(
        await fixture.broker["hook"]({ ...body, hook_event_name: "PreCompact" }, headers),
      ).toBeNull();
      const resumed = await fixture.broker["hook"](
        { ...body, hook_event_name: "SessionStart", source: "compact" },
        headers,
      );
      expect(JSON.stringify(resumed).split("Keep the price invariant.")).toHaveLength(2);
      const next = await fixture.broker["hook"](
        {
          ...body,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "git status" },
        },
        headers,
      );
      expect(JSON.stringify(next)).not.toContain("Keep the price invariant.");
    } finally {
      await fixture.dispose();
    }
  });

  it.each(["SessionEnd", "Interrupt"])(
    "answers Codex %s within its three-second harness limit",
    async (event) => {
      const fixture = await brokerFixture();
      const entered = Promise.withResolvers<void>();
      const finished = Promise.withResolvers<null>();
      try {
        await fixture.broker["sessionFor"](
          "codex",
          { session_id: "ending", cwd: fixture.root },
          undefined,
        );
        fixture.broker["answerHook"] = async () => {
          entered.resolve();
          return finished.promise;
        };
        vi.useFakeTimers();
        const pending = fixture.broker["hookInTime"](
          { session_id: "ending", cwd: fixture.root, hook_event_name: event },
          { "x-peer-agent": "codex" },
        );
        await entered.promise;
        await vi.advanceTimersByTimeAsync(2000);
        let answered = false;
        void pending.then(() => {
          answered = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(answered).toBe(true);
        expect(await pending).toBeNull();
      } finally {
        vi.useRealTimers();
        finished.resolve(null);
        await fixture.dispose();
      }
    },
  );

  it("delivers startup guidance before a slow hub finishes, then queues the complete context", async () => {
    const fixture = await brokerFixture();
    const completed = Promise.withResolvers<Record<string, unknown>>();
    const entered = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    try {
      await fixture.register("slow");
      const originalLog = fixture.broker["record"].bind(fixture.broker);
      fixture.broker["record"] = (event, data) => {
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
      const jjPublish = fixture.broker["hookInTime"](
        { ...body, tool_name: "Bash", tool_input: { command: "jj git push -b feature/x" } },
        {},
      );
      await vi.advanceTimersByTimeAsync(4000);
      expect((await jjPublish)?.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
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
      await fixture.broker.host.log.idle();
      const log = await NodeFSP.readFile(fixture.debugPath, "utf8");
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
          recovery: "complete",
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
      expect(blocked?.hookSpecificOutput).toMatchObject({
        permissionDecision: "deny",
        permissionDecisionReason:
          "Peer: shared inputs changed. Read the current version before publishing, or explicitly confirm its change with peer ack <task>: prices v1 → v2.",
      });
      expect(JSON.stringify(blocked)).toContain("prices");
      const jjPush = await fixture.broker["hook"](
        { ...body, tool_input: { command: "jj git push -b feature/KRK-1-ab12" } },
        {},
      );
      expect(jjPush?.hookSpecificOutput).toMatchObject({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("prices v1 → v2"),
      });
      const refusal = await fixture.broker.handoffRefusal(
        fixture.broker.sessions.get("claude:one")!,
      );
      expect(refusal).toMatchObject({
        reason: expect.stringContaining("prices v1 → v2"),
        next: expect.stringContaining("peer context <task>, recheck the result and retry"),
      });
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
