import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { brokerFixture } from "./testkit.ts";
import { NO_PLUGINS } from "./host.ts";
import type { PeerContributions } from "../plugin.ts";

describe("complete plugin text receipts", () => {
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
      const text = (out?.hookSpecificOutput as { additionalContext: string }).additionalContext;
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
