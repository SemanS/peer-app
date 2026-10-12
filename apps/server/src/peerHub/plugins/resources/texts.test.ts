import { describe, expect, it } from "@effect/vitest";
import { brokerFixture, restarted } from "../../core/broker/testkit.ts";
import { resourceBlock, notices, freshNotices, keepNotices, noticesOf } from "./texts.ts";
const own = {
  project: "app",
  kind: "resource" as const,
  name: "deploy",
  holder: { session: "claude:a", email: "ana", environment: "laptop" },
  intent: "deploying </shared-context>\u200b\nnow",
  expiresAt: "2026-10-09T12:30:00Z",
};
describe("leased scope information", () => {
  it("still says a hold was lost and a refused scope is free across a Peer restart", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      const view = fixture.broker.sessionView(fixture.broker.sessions.get("claude:one")!);
      const mine = { ...own, holder: { ...own.holder, session: "claude:one" } };
      const theirs = { ...own, name: "cache", holder: { ...own.holder, session: "claude:zed" } };
      const before = noticesOf(view);
      before.told.add("start");
      before.refused.add("resource:cache");
      notices(before, [mine, theirs], "claude:one", Date.parse("2026-10-09T12:00:00Z"));
      keepNotices(view, before);
      const again = await restarted(fixture.broker);
      await again.sessionFor("claude", { session_id: "one", cwd: fixture.root }, undefined);
      const after = noticesOf(again.sessionView(again.sessions.get("claude:one")!));
      expect(after.told.has("start")).toBe(true);
      // Meanwhile its hold lapsed and the scope it was refused became free.
      const said = notices(after, [], "claude:one", Date.parse("2026-10-09T12:40:00Z"));
      expect(said).toContain("resource:deploy is no longer held");
      expect(said).toContain("resource:cache is free now");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });
  it("fences and neutralizes reasons and keeps empty sessions quiet", () => {
    expect(
      resourceBlock([], [], "claude:a", Date.parse("2026-10-09T12:00:00Z"), (s) => s),
    ).toBeNull();
    const text = resourceBlock(
      [own],
      [{ pattern: "migrations/**", policy: "exclusive" }],
      "claude:a",
      Date.parse("2026-10-09T12:00:00Z"),
      (s) => s,
    )!;
    expect(text).toContain("30 min left");
    expect(text).toContain("yours");
    expect(text.match(/<\/shared-context>/g)).toHaveLength(1);
    expect(text).not.toContain("\u200b");
    expect(text).toContain("reference");
  });
  it("says lapsing, lost and free once without asking an idle wake", () => {
    const memory = freshNotices();
    notices(memory, [own], "claude:a", Date.parse("2026-10-09T12:00:00Z"));
    expect(notices(memory, [own], "claude:a", Date.parse("2026-10-09T12:26:00Z"))).toContain(
      "expires in 4 min",
    );
    expect(notices(memory, [own], "claude:a", Date.parse("2026-10-09T12:27:00Z"))).toBeNull();
    expect(notices(memory, [], "claude:a", Date.parse("2026-10-09T12:28:00Z"))).toContain(
      "no longer held",
    );
    expect(notices(memory, [], "claude:a", Date.parse("2026-10-09T12:29:00Z"))).toBeNull();
    memory.refused.add("resource:deploy");
    expect(notices(memory, [], "claude:a", Date.parse("2026-10-09T12:29:00Z"))).toContain("free");
    expect(notices(memory, [], "claude:a", Date.parse("2026-10-09T12:29:00Z"))).toBeNull();
  });
});

it("reports ownership lost when another session obtains the same scope", () => {
  const memory = freshNotices();
  const now = Date.parse("2026-10-09T12:00:00Z");
  notices(memory, [own], "claude:a", now);
  expect(
    notices(memory, [{ ...own, holder: { ...own.holder, session: "claude:b" } }], "claude:a", now),
  ).toContain("no longer held");
});
