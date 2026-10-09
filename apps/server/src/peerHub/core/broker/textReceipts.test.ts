// @effect-diagnostics nodeBuiltinImport:off - native HTTP calls on the temporary broker socket.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { brokerFixture } from "./testkit.ts";
import { NO_PLUGINS } from "./host.ts";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import type { PeerContributions } from "../plugin.ts";

describe("complete plugin text receipts", () => {
  it("drops queued referenced text after its plugin is disabled", async () => {
    let on = true;
    let drop!: () => void;
    const dropped = new Promise<void>((resolve) => {
      drop = resolve;
    });
    const contributions: PeerContributions = {
      hooks: {
        notices: [
          {
            wakes: false,
            read: () => Effect.succeed({ text: "Pending announcement", refs: ["one"] }),
          },
        ],
        delivery: ({ state }) =>
          Effect.sync(() => {
            if (state === "dropped") drop();
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: on ? [{ id: "knowledge", title: "fake", contributions }] : [],
      }),
    }));
    try {
      await fixture.register("one");
      const body = { session_id: "one", cwd: fixture.root };
      await fixture.broker["hook"](
        { ...body, hook_event_name: "UserPromptSubmit", prompt: "Go" },
        {},
        { passed: true },
      );
      on = false;
      const answer = await fixture.broker["hook"](
        {
          ...body,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        {},
      );
      expect(JSON.stringify(answer)).not.toContain("Pending announcement");
      await dropped;
    } finally {
      await fixture.dispose();
    }
  });
  it("flushes ownership-bound reports before releasing a session and keeps end callbacks after removal", async () => {
    const seen: boolean[] = [];
    const contributions: PeerContributions = {
      hooks: {
        sessionEnding: () =>
          Effect.sync(() => {
            seen.push(fixture.broker.sessionViews().some((session) => session.id === "claude:one"));
          }),
        sessionEnd: () =>
          Effect.sync(() => {
            seen.push(fixture.broker.sessionViews().some((session) => session.id === "claude:one"));
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "knowledge", title: "fake", contributions }],
      }),
    }));
    try {
      await fixture.register("one");
      await fixture.broker["hook"](
        { session_id: "one", cwd: fixture.root, hook_event_name: "SessionEnd" },
        {},
      );
      expect(seen).toEqual([true, false]);
    } finally {
      await fixture.dispose();
    }
  });
  it("only a Mod's exact delivery proof advances plugin refs to modelInput", async () => {
    const states: string[] = [];
    const contributions: PeerContributions = {
      hooks: {
        notices: [
          { wakes: false, read: () => Effect.succeed({ text: "Whole notice", refs: ["one"] }) },
        ],
        delivery: ({ state }) =>
          Effect.sync(() => {
            states.push(state);
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "knowledge", title: "fake", contributions }],
      }),
    }));
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
            response.on("end", () => resolve({ status: response.statusCode!, text }));
            response.on("error", reject);
          },
        );
        request.on("error", reject);
        request.end(JSON.stringify(body));
      });
    try {
      await fixture.broker.start();
      const answer = await post("/hook", {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "UserPromptSubmit",
        prompt: "Go",
      });
      const id = (JSON.parse(answer.text) as { peerDelivery: { id: string } }).peerDelivery.id;
      expect(states).toEqual(["offered"]);
      expect((await post("/delivery", { session_id: "one", id, evidence: "sent" })).status).toBe(
        400,
      );
      expect(
        (await post("/delivery", { session_id: "one", id: "other", evidence: "model-input" }))
          .status,
      ).toBe(400);
      expect(states).toEqual(["offered"]);
      expect(
        (await post("/delivery", { session_id: "one", id, evidence: "model-input" })).status,
      ).toBe(204);
      expect(
        (await post("/delivery", { session_id: "one", id, evidence: "model-input" })).status,
      ).toBe(204);
      expect(states).toEqual(["offered", "modelInput"]);
    } finally {
      await fixture.dispose();
    }
  });
  it("offers an idle wait notice and passes waking, without asserting model input", async () => {
    const states: string[] = [];
    const contributions: PeerContributions = {
      hooks: {
        notices: [
          {
            wakes: true,
            read: ({ waking }) =>
              Effect.succeed(waking ? { text: "Wake notice", refs: ["one"] } : null),
          },
        ],
        delivery: ({ state }) =>
          Effect.sync(() => {
            states.push(state);
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "knowledge", title: "fake", contributions }],
      }),
    }));
    try {
      await fixture.register("one");
      const session = fixture.broker["sessions"].get("claude:one")!;
      session.status = "working";
      expect(
        await fixture.broker["wakingNews"](session, await fixture.broker["plugins"]()),
      ).toBeNull();
      session.status = "blocked";
      expect(
        await fixture.broker["wakingNews"](session, await fixture.broker["plugins"]()),
      ).toBeNull();
      session.status = "idle";
      expect(
        await fixture.broker["wait"](
          { session_id: "one", cwd: fixture.root },
          { "x-peer-adapter": "mod" },
        ),
      ).toBe("Wake notice");
      expect(states).toEqual(["offered"]);
    } finally {
      await fixture.dispose();
    }
  });
  it("places first-priority full text before core and offers its opaque refs once", async () => {
    const states: string[] = [];
    const contributions: PeerContributions = {
      hooks: {
        priority: "first",
        sessionStart: () =>
          Effect.succeed({ text: "Important team information", refs: ["private-ref"] }),
        delivery: ({ state, refs }) =>
          Effect.sync(() => {
            states.push(`${state}:${refs.join()}`);
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "knowledge", title: "fake", contributions }],
      }),
    }));
    try {
      const out = await fixture.broker["hook"](
        {
          hook_event_name: "SessionStart",
          source: "startup",
          session_id: "one",
          cwd: fixture.root,
        },
        {},
      );
      const text = (out!.hookSpecificOutput as { additionalContext: string }).additionalContext;
      expect(text.startsWith("Important team information\n\n")).toBe(true);
      expect(states).toEqual(["offered:private-ref"]);
      expect(JSON.stringify(out)).not.toContain("private-ref");
    } finally {
      await fixture.dispose();
    }
  });
  it("never cuts and offers part of a referenced block", async () => {
    const states: string[] = [];
    const contributions: PeerContributions = {
      hooks: {
        notices: [
          { wakes: false, read: () => Effect.succeed({ text: "x".repeat(1201), refs: ["one"] }) },
        ],
        delivery: ({ state }) =>
          Effect.sync(() => {
            states.push(state);
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "knowledge", title: "fake", contributions }],
      }),
    }));
    try {
      await fixture.register("one");
      const out = await fixture.broker["hook"](
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "Work",
          session_id: "one",
          cwd: fixture.root,
        },
        {},
      );
      expect(JSON.stringify(out)).not.toContain("x".repeat(50));
      expect(states).toEqual(["dropped"]);
    } finally {
      await fixture.dispose();
    }
  });
  it("retains late hook refs until the next hook and drops queued refs on clear", async () => {
    let reads = 0;
    const states: string[] = [];
    const contributions: PeerContributions = {
      hooks: {
        notices: [
          {
            wakes: false,
            read: () =>
              Effect.sync(() =>
                ++reads === 1 ? { text: "Deferred notice", refs: ["one"] } : null,
              ),
          },
        ],
        delivery: ({ state }) =>
          Effect.sync(() => {
            states.push(state);
          }),
      },
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [{ id: "knowledge", title: "fake", contributions }],
      }),
    }));
    try {
      await fixture.register("one");
      const body = { session_id: "one", cwd: fixture.root };
      await fixture.broker["hook"](
        { ...body, hook_event_name: "UserPromptSubmit", prompt: "Go" },
        {},
        { passed: true },
      );
      expect(states).toEqual([]);
      const next = await fixture.broker["hook"](
        {
          ...body,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        {},
      );
      expect(JSON.stringify(next)).toContain("Deferred notice");
      expect(states).toEqual(["offered"]);
      reads = 0;
      await fixture.broker["hook"](
        { ...body, hook_event_name: "UserPromptSubmit", prompt: "Go" },
        {},
        { passed: true },
      );
      await fixture.broker["hook"](
        { ...body, hook_event_name: "SessionStart", source: "clear" },
        {},
      );
      expect(states).toEqual(["offered", "dropped"]);
    } finally {
      await fixture.dispose();
    }
  });
});
