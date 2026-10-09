import { describe, expect, it } from "vite-plus/test";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

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
      fixture.broker.news = () => "A new project announcement";
      expect(await fixture.broker.wakingNews(session, NO_PLUGINS)).toBe(
        "A new project announcement",
      );
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
        fixture.broker.news = () => "A new project announcement";
        expect(await fixture.broker.wakingNews(session, NO_PLUGINS)).toBe(
          "A new project announcement",
        );
        selected = { agent, nativeId: "current", cwd: "" };
        expect(await fixture.broker.wakingNews(session, NO_PLUGINS)).toBeNull();
        expect(fixture.broker.sessions.has(session.id)).toBe(false);
        await fixture.register("previous");
        expect(fixture.broker.sessions.has(session.id)).toBe(false);
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
