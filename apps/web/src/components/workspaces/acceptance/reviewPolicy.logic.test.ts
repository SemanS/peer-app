import type { PeerProjectReviewPolicy } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { REVIEW_SIGNAL_LINES, reviewPolicyView, saveOutcome } from "./reviewPolicy.logic";

const nameOf = (email: string) => (email === "ana@acme.test" ? "Ana" : email);
const date = (at: string) => at.slice(0, 10);
const read = (policy: PeerProjectReviewPolicy["policy"], available = true) => ({
  workspace: "acme",
  project: "app",
  available,
  policy,
});

describe("a policy whose lead left", () => {
  it("says a lead must save it again", () => {
    const view = reviewPolicyView(
      {
        workspace: "w",
        project: "p",
        available: true,
        policy: { mode: "auto", version: 2, updatedBy: "a", leadLeft: true },
      },
      true,
      (email) => email,
      (at) => at,
    );
    expect(view.kind === "ready" && view.setBy).toContain("until a lead saves it again");
  });
});

describe("the review policy section", () => {
  it("lets a lead save and shows a member the rule and who set it", () => {
    const policy = read({
      mode: "auto",
      version: 2,
      updatedBy: "ana@acme.test",
      updatedAt: "2026-10-30T10:00:00Z",
    });
    expect(reviewPolicyView(policy, true, nameOf, date)).toEqual({
      kind: "ready",
      mode: "auto",
      version: 2,
      setBy: "Set by Ana · 2026-10-30 (version 2).",
      canSave: true,
    });
    expect(reviewPolicyView(policy, false, nameOf, date)).toMatchObject({ canSave: false });
  });

  it("reads a project nobody set a rule for as asking a person", () => {
    expect(reviewPolicyView(read({ mode: "ask", version: 0 }), true, nameOf, date)).toMatchObject({
      mode: "ask",
      setBy: "Nobody set a rule yet: a person reviews every handoff.",
    });
  });

  it("says an older Hub keeps no policy, and offers nothing", () => {
    expect(reviewPolicyView(read({ mode: "ask", version: 0 }, false), true, nameOf, date)).toEqual({
      kind: "older-hub",
    });
    expect(reviewPolicyView(undefined, true, nameOf, date)).toEqual({ kind: "loading" });
  });

  it("lists the six signals in words", () => {
    expect(REVIEW_SIGNAL_LINES).toHaveLength(6);
    expect(REVIEW_SIGNAL_LINES[0]).toBe("The task has no test report");
  });

  it("names who saved first when a save came from an older version", () => {
    expect(saveOutcome({ kind: "saved", policy: { mode: "auto", version: 3 } }, nameOf)).toBeNull();
    expect(
      saveOutcome(
        { kind: "stale", policy: { mode: "ask", version: 4, updatedBy: "ana@acme.test" } },
        nameOf,
      ),
    ).toBe("Ana saved the rule meanwhile: Ask a person. Nothing of yours was saved; choose again.");
  });
});
