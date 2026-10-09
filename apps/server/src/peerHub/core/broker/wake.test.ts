import { describe, expect, it } from "vite-plus/test";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

describe("advisory tool wake delivery", () => {
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
