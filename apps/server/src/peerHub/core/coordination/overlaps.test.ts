// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - broker fixtures in a temporary checkout, and a stand-in hub on a local port.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { brokerFixture } from "../broker/testkit.ts";
import type {
  HubCoordSession,
  HubCoordView,
  HubIntentAnswer,
  HubIntentRequest,
  HubOverlap,
} from "../hub/coordApi.ts";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("the hub hears of an edit", () => {
  const at = "2026-10-06T10:00:00Z";
  const vir: HubCoordSession = {
    id: "claude:vir",
    project: "app",
    email: "vir@acme.test",
    environment: "vir-laptop",
    label: "Frontend implementation",
    agent: "claude",
    status: "working",
    files: [],
    claims: [],
    seenAt: at,
  };
  const overlapWith = (session: string, extra: Partial<HubOverlap> = {}): HubOverlap => ({
    id: "abc123def456",
    project: "app",
    sessions: [session, "claude:vir"],
    files: ["src/pay.ts"],
    openedAt: at,
    updatedAt: at,
    ...extra,
  });
  /** What the hub answers for one path: the verdict and the overlap it opened with Vir's agent. */
  const answerOf = (
    session: string,
    verdict: string,
    extra: Partial<HubIntentAnswer> = {},
  ): HubIntentAnswer => ({
    verdicts: [
      {
        path: "src/pay.ts",
        verdict,
        with: ["claude:vir"],
        overlaps: ["abc123def456"],
      },
    ],
    overlaps: [overlapWith(session)],
    at,
    ...extra,
  });
  const viewOf = (extra: Partial<HubCoordView> = {}): HubCoordView => ({
    sessions: [vir],
    overlaps: [],
    at,
    ...extra,
  });
  const people = (_workspace: string, email: string) => (email.startsWith("vir") ? "Vir" : "Ana");

  const editBody = (root: string, id: string, agent: "claude" | "codex", file = "src/pay.ts") => ({
    hook_event_name: "PreToolUse",
    session_id: id,
    cwd: root,
    ...(agent === "codex"
      ? {
          tool_name: "apply_patch",
          tool_input: {
            command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch`,
          },
        }
      : {
          tool_name: "Edit",
          tool_input: { file_path: NodePath.join(root, file), old_string: "a", new_string: "b" },
        }),
  });
  type Fixture = Awaited<ReturnType<typeof brokerFixture>>;
  const edit = (
    fixture: Fixture,
    id: string,
    agent: "claude" | "codex" = "claude",
    file?: string,
  ) =>
    fixture.broker["hook"](
      editBody(fixture.root, id, agent, file),
      agent === "codex" ? { "x-peer-agent": "codex" } : {},
    );
  const hookOutput = (out: Record<string, unknown> | null) =>
    (out?.hookSpecificOutput ?? {}) as {
      readonly permissionDecision?: string;
      readonly permissionDecisionReason?: string;
      readonly additionalContext?: string;
    };
  const events = async (fixture: Fixture) => {
    await fixture.broker.host.log.idle();
    const text = await NodeFSP.readFile(fixture.debugPath, "utf8");
    return text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; [field: string]: unknown });
  };
  it("tells the agent who else is on the file, stops nothing, and takes what the hub recorded into the view at once", async () => {
    const asked: Array<{ readonly request: HubIntentRequest; readonly timeoutMs: number }> = [];
    const fixture = await brokerFixture(() => ({
      nameOf: people,
      report: async () => viewOf(),
      intent: async (_workspace, _project, request, timeoutMs) => {
        asked.push({ request, timeoutMs });
        return answerOf(request.session, "notify");
      },
    }));
    try {
      const out = hookOutput(await edit(fixture, "one"));
      expect(out.permissionDecision).toBeUndefined();
      expect(out.additionalContext).toContain("Vir's agent");
      expect(out.additionalContext).toContain("also about to change src/pay.ts");
      expect(asked).toHaveLength(1);
      expect(asked[0]?.request).toMatchObject({
        environment: "test",
        session: "claude:one",
        paths: ["src/pay.ts"],
      });
      expect(asked[0]?.request).not.toHaveProperty("policy");
      expect(asked[0]?.request.op).toEqual(expect.any(String));
      expect(asked[0]?.timeoutMs).toBeLessThanOrEqual(2000);
      expect(fixture.broker.snapshot().overlaps.map((overlap) => overlap.id)).toContain(
        "abc123def456",
      );
      const log = await events(fixture);
      expect(log.find((entry) => entry.event === "intent")).toMatchObject({
        verdicts: [{ path: "src/pay.ts", verdict: "notify", with: ["claude:vir"] }],
      });
      expect(log.find((entry) => entry.event === "decision")).toMatchObject({
        file: "src/pay.ts",
        with: ["claude:vir"],
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("asks the hub for every edit, and lets an edit through that it cleared", async () => {
    let asked = 0;
    const fixture = await brokerFixture(() => ({
      report: async () => viewOf(),
      intent: async (_workspace, _project, request) => {
        asked += 1;
        return answerOf(request.session, "clear", {
          verdicts: [{ path: "src/pay.ts", verdict: "clear", with: [], overlaps: [] }],
          overlaps: [],
        });
      },
    }));
    try {
      expect(hookOutput(await edit(fixture, "one")).permissionDecision).toBeUndefined();
      expect(await edit(fixture, "one")).toBeNull();
      expect(asked).toBe(2);
    } finally {
      await fixture.dispose();
    }
  });

  it("asks one hub call per fifty paths of a patch", async () => {
    const sizes: number[] = [];
    const fixture = await brokerFixture(() => ({
      report: async () => viewOf(),
      intent: async (_workspace, _project, request) => {
        sizes.push(request.paths.length);
        return answerOf(request.session, "clear", { verdicts: [], overlaps: [] });
      },
    }));
    try {
      const files = Array.from({ length: 120 }, (_, at) => `src/gen/file-${at}.ts`);
      const patch = files.flatMap((file) => [`*** Update File: ${file}`, "@@", "-a", "+b"]);
      await fixture.broker["hook"](
        {
          hook_event_name: "PreToolUse",
          session_id: "patch",
          cwd: fixture.root,
          tool_name: "apply_patch",
          tool_input: { command: ["*** Begin Patch", ...patch, "*** End Patch"].join("\n") },
        },
        { "x-peer-agent": "codex" },
      );
      expect(sizes.toSorted((a, b) => a - b)).toEqual([20, 50, 50]);
    } finally {
      await fixture.dispose();
    }
  });

  it.each(["claude", "codex"] as const)(
    "tells %s once for each file, and reads anything but clear as someone else on it",
    async (agent) => {
      const verdict = { current: "notify" };
      const fixture = await brokerFixture(() => ({
        nameOf: people,
        report: async () => viewOf(),
        intent: async (_workspace, _project, request) => answerOf(request.session, verdict.current),
      }));
      try {
        const heads = hookOutput(await edit(fixture, "one", agent));
        expect(heads.permissionDecision).toBeUndefined();
        expect(heads.additionalContext).toContain("also about to change src/pay.ts");
        expect(await edit(fixture, "one", agent)).toBeNull();
        // What an older hub may still answer: another session, told as such, and nothing stops it.
        for (const [id, kind] of [
          ["two", "deny"],
          ["three", "held"],
          ["four", "ask"],
        ] as const) {
          verdict.current = kind;
          const out = hookOutput(await edit(fixture, id, agent));
          expect(out.permissionDecision).toBeUndefined();
          expect(out.additionalContext).toContain("also about to change src/pay.ts");
        }
      } finally {
        await fixture.dispose();
      }
    },
  );

  it("lets an edit go on when the hub fails, and records that nobody heard of it", async () => {
    const fixture = await brokerFixture(() => ({
      report: async () => viewOf(),
      intent: async () => {
        throw new Error("connection refused");
      },
    }));
    try {
      expect(await edit(fixture, "one")).toBeNull();
      const log = await events(fixture);
      expect(log.find((entry) => entry.event === "intent.failed")).toMatchObject({
        reason: "connection refused",
        files: ["src/pay.ts"],
      });
      expect(log.filter((entry) => entry.event === "intent.unverified")).toMatchObject([
        { files: ["src/pay.ts"] },
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  it("goes on when the hub does not answer within its deadline", async () => {
    const called = Promise.withResolvers<void>();
    let timeoutMs = 0;
    const fixture = await brokerFixture(() => ({
      report: async () => viewOf(),
      intent: (_workspace, _project, _request, given) => {
        timeoutMs = given;
        called.resolve();
        return new Promise<never>(() => undefined);
      },
    }));
    try {
      // The session is known to the hub: only the hub is left to wait for.
      await fixture.broker["sessionFor"](
        "claude",
        { session_id: "slow", cwd: fixture.root },
        undefined,
      );
      await fixture.broker["sync"]("acme");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const pending = edit(fixture, "slow");
        // Its timer is set as the hub is asked; should the hub not be asked, the answer comes without it.
        await Promise.race([called.promise, pending]);
        await vi.advanceTimersByTimeAsync(2000);
        expect(await pending).toBeNull();
      } finally {
        vi.useRealTimers();
      }
      // What was left of its 2 s when the hub was asked, not more.
      expect(timeoutMs).toBeGreaterThan(1500);
      expect(timeoutMs).toBeLessThanOrEqual(2000);
      expect(
        (await events(fixture)).find((entry) => entry.event === "intent.failed"),
      ).toMatchObject({
        reason: "timeout",
        files: ["src/pay.ts"],
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("tells exactly one of two computers' first edits of a file of the other, however close they come", async () => {
    // A hub that decides in one step, as the real one does: whoever asks first holds the path.
    const holders = new Map<string, string>();
    const asked: string[] = [];
    const hub = NodeHttp.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => (raw += chunk));
      request.on("end", () => {
        const ask = JSON.parse(raw) as HubIntentRequest;
        asked.push(ask.session);
        const overlaps: HubOverlap[] = [];
        const verdicts = ask.paths.map((path) => {
          const holder = holders.get(path);
          if (holder === undefined || holder === ask.session) {
            holders.set(path, ask.session);
            return { path, verdict: "clear" as const, with: [], overlaps: [] };
          }
          overlaps.push({
            ...overlapWith(ask.session),
            id: `ov-${path.replace(/\W/g, "-")}`.slice(0, 40),
            sessions: [ask.session, holder].toSorted(),
            files: [path],
          });
          return {
            path,
            verdict: "notify" as const,
            with: [holder],
            overlaps: overlaps.map((overlap) => overlap.id),
          };
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ verdicts, overlaps, at }));
      });
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(hub.address() as NodeNet.AddressInfo).port}`;
    const computer = () =>
      brokerFixture(() => ({
        report: async () => viewOf({ sessions: [] }),
        // Over the wire, as Peer's hub client does it (its own tests cover that client).
        intent: async (_workspace, _project, request) =>
          (await fetch(`${url}/intent`, {
            method: "POST",
            body: JSON.stringify(request),
          }).then((response) => response.json())) as HubIntentAnswer,
      }));
    const ana = await computer();
    const bob = await computer();
    try {
      for (let round = 0; round < 20; round += 1) {
        const file = `src/race-${round}.ts`;
        const outs = await Promise.all([
          edit(ana, "ana", "claude", file),
          edit(bob, "bob", "claude", file),
        ]);
        const told = outs.filter((out) => hookOutput(out).additionalContext !== undefined);
        expect(told, `round ${round + 1}: ${JSON.stringify(outs)}`).toHaveLength(1);
        expect(outs.every((out) => hookOutput(out).permissionDecision === undefined)).toBe(true);
      }
      // Each edit asked the hub: neither computer decided on a view of its own.
      expect(asked).toHaveLength(40);
    } finally {
      await Promise.all([ana.dispose(), bob.dispose()]);
      await new Promise<void>((resolve) => {
        hub.closeAllConnections();
        hub.close(() => resolve());
      });
    }
  });
});
