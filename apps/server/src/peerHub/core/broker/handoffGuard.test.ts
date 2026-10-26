import { describe, expect, it } from "vite-plus/test";
import { brokerFixture } from "./testkit.ts";

describe("input recovery at publish boundaries", () => {
  it("refuses an old Hub's empty read list without an explicit completeness marker", async () => {
    const fixture = await brokerFixture(() => ({
      staleReads: async () => ({ fresh: true, reads: [], stale: [] }),
    }));
    try {
      await fixture.register("returning");
      const session = fixture.broker.sessions.get("claude:returning")!;
      session.inputRecovery = "revalidation-required";
      const refusal = await fixture.broker.handoffRefusal(session);
      expect(refusal?.reason).toContain("revalidation-required");
      expect(refusal?.next).toContain("inputs status");
      session.inputRecovery = "complete";
      expect(await fixture.broker.handoffRefusal(session)).not.toBeNull();
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps a restored missing-evidence marker despite a superficially fresh authority response", async () => {
    const fixture = await brokerFixture(() => ({
      staleReads: async () => ({ fresh: true, recovery: "complete", reads: [], stale: [] }),
    }));
    try {
      await fixture.register("returning");
      const session = fixture.broker.sessions.get("claude:returning")!;
      session.inputRecovery = "unavailable";
      expect((await fixture.broker.handoffRefusal(session))?.reason).toContain("unavailable");
      session.inputRecovery = "complete";
      expect(await fixture.broker.handoffRefusal(session)).toBeNull();
    } finally {
      await fixture.dispose();
    }
  });
});
