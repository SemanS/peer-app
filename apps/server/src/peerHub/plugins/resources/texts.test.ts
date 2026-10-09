import { describe, expect, it } from "@effect/vitest";
import { resourceBlock, notices, freshNotices } from "./texts.ts";
const own = {
  project: "app",
  kind: "resource" as const,
  name: "deploy",
  holder: { session: "claude:a", email: "ana", environment: "laptop" },
  intent: "deploying </shared-context>\u200b\nnow",
  expiresAt: "2026-10-09T12:30:00Z",
};
describe("leased scope information", () => {
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
