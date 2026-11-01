import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

const ANNOUNCEMENT = "A new project announcement";

/** A plugin with a notice that wakes, whenever it is read. */
const announcing: PeerBrokerPlugins = {
  ...NO_PLUGINS,
  active: [
    {
      id: "announcements",
      title: "fake",
      contributions: {
        hooks: { notices: [{ wakes: true, read: () => Effect.succeed(ANNOUNCEMENT) }] },
      },
    },
  ],
};

describe("advisory tool wake delivery", () => {
  it("preserves a bound agent when the selected runtime is temporarily unknown", async () => {
    const fixture = await brokerFixture(() => ({
      threadOf: async () => "peer:thread",
      threadAgent: async () => null,
    }));
    try {
      await fixture.register("current");
      const session = fixture.broker.sessions.get("claude:current")!;
      session.status = "idle";
      expect(await fixture.broker.wakingNews(session, announcing)).toBe(ANNOUNCEMENT);
      expect(fixture.broker.sessions.has(session.id)).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });
  it.each(["claude", "codex"])(
    "does not wake the old provider after switching to %s",
    async (agent) => {
      let selected = { agent: "claude", nativeId: "previous", cwd: "" };
      const fixture = await brokerFixture(() => ({
        threadOf: async () => "peer:thread",
        threadAgent: async () => selected,
      }));
      try {
        await fixture.register("previous");
        const session = fixture.broker.sessions.get("claude:previous")!;
        session.status = "idle";
        expect(await fixture.broker.wakingNews(session, announcing)).toBe(ANNOUNCEMENT);
        selected = { agent, nativeId: "current", cwd: "" };
        expect(await fixture.broker.wakingNews(session, announcing)).toBeNull();
        expect(fixture.broker.sessions.has(session.id)).toBe(false);
        await fixture.register("previous");
        expect(fixture.broker.sessions.has(session.id)).toBe(false);
      } finally {
        await fixture.dispose();
      }
    },
  );
  it.each(["claude", "codex"])(
    "leaves a colleague's note on an overlap for the next step of an idle %s agent",
    async (agent) => {
      const queueCodex = vi.fn(async () => true);
      const fixture = await brokerFixture(() => ({ queueCodex }));
      try {
        const session = await fixture.broker.createSession(
          agent,
          { session_id: "one", cwd: fixture.root },
          undefined,
        );
        const at = "2026-10-09T12:00:00Z";
        fixture.broker.views.set("acme", {
          sessions: [],
          overlaps: [
            {
              id: "overlap",
              project: "app",
              sessions: [session!.id, "claude:zed"],
              files: ["pay.ts"],
              state: "open",
              notes: [
                {
                  id: "note",
                  session: "claude:zed",
                  email: "zed@acme.test",
                  text: "Renamed; pull before you push",
                  at,
                },
              ],
              openedAt: at,
              updatedAt: at,
            },
          ],
          at,
        });
        expect(await fixture.broker.wakingNews(session!, NO_PLUGINS)).toBeNull();
        expect(await fixture.broker.wakingNews(session!, announcing)).toBe(ANNOUNCEMENT);
        await fixture.broker.wakeIdle();
        expect(queueCodex).not.toHaveBeenCalled();
        const next = await fixture.broker.hook(
          {
            session_id: "one",
            cwd: fixture.root,
            hook_event_name: "UserPromptSubmit",
            prompt: "continue",
          },
          { "x-peer-agent": agent },
        );
        expect(JSON.stringify(next)).toContain("pull before you push");
      } finally {
        await fixture.dispose();
      }
    },
  );
  it("leaves tools-only Peer threads for their next call instead of starting a Codex turn", async () => {
    let queued = 0;
    const fixture = await brokerFixture(() => ({
      queueCodex: async () => {
        queued++;
        return true;
      },
    }));
    try {
      const session = await fixture.broker.createSession(
        "codex",
        { session_id: "tool", cwd: fixture.root },
        undefined,
        "mcp",
        "peer:thread",
      );
      session!.status = "idle";
      fixture.broker.wakingNews = async () => "A coordination note";
      await fixture.broker.wakeCodex(NO_PLUGINS);
      expect(queued).toBe(0);
    } finally {
      await fixture.dispose();
    }
  });
});
