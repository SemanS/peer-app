import type { PeerHubStatus, PeerTestReportSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ANA, CYRIL, EVA, NOW, statusFor, teamProject } from "../ownership/ownership.testkit";
import { assignRights, authorLine, teamSignals, teamTaskFacts } from "./testReports.logic";

const summary = (over: Partial<PeerTestReportSummary> = {}): PeerTestReportSummary => ({
  workspace: "acme",
  project: "ordering",
  task: "vl7",
  author: ANA,
  number: 2,
  result: "mixed",
  role: "author",
  at: "2026-10-12T20:00:00Z",
  passed: 1,
  failed: 0,
  unverified: 1,
  unowned: 1,
  ...over,
});

const withReports = (status: PeerHubStatus, summaries: PeerTestReportSummary[]) =>
  ({ ...status, testReports: { summaries } }) as PeerHubStatus;

const VL7 = { id: "vl7", key: "VL7", title: "Receipt totals in cents" };

describe("the Team page", () => {
  it("gives a task its newest result, waiting on a person while an item has no owner", () => {
    const status = withReports(statusFor(EVA), [
      summary({ author: CYRIL, at: "2026-10-12T18:00:00Z", result: "pass", unowned: 0 }),
      summary(),
    ]);
    const project = teamProject(EVA);
    const fact = teamTaskFacts({ status, project, now: NOW, task: VL7 });
    expect(fact).toMatchObject({
      text: "Tests: mixed · 1 unverified item needs an owner",
      tone: "needs",
    });
    expect(teamTaskFacts({ status: statusFor(EVA), project, now: NOW, task: VL7 })).toBeUndefined();
    const quiet = withReports(statusFor(EVA), [summary({ unowned: 0, result: "pass" })]);
    expect(teamTaskFacts({ status: quiet, project, now: NOW, task: VL7 })).toMatchObject({
      text: "Tests: pass",
      tone: "neutral",
    });
  });

  it("signals each task whose newest report has items nobody answers for", () => {
    const status = withReports(statusFor(EVA), [
      summary({ unowned: 2, unverified: 2 }),
      summary({ task: "vl9", unowned: 0 }),
    ]);
    const signals = teamSignals({ status, project: teamProject(EVA), now: NOW });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: "unowned:vl7",
      what: "VL7: 2 unverified items need an owner",
      since: "2026-10-12T20:00:00Z",
      action: { label: "Open task" },
    });
    expect(signals[0]!.detail).toContain("Test report 2 by Ana is mixed");
  });
});

describe("who gives an item an owner on the task page", () => {
  const place = { workspace: "acme", project: "ordering", task: "vl7" };

  it("is the task's owner, a lead or an admin", () => {
    expect(assignRights(statusFor(ANA), place)).toBe(true);
    expect(assignRights(statusFor(EVA), place)).toBe(true);
    expect(assignRights(statusFor(CYRIL), place)).toBe(false);
    expect(assignRights(statusFor(CYRIL, { workspace: "admin" }), place)).toBe(true);
  });

  it("is only leads and admins while ownership is not known", () => {
    expect(assignRights(statusFor(ANA, { ownership: null }), place)).toBe(false);
    expect(assignRights(statusFor(EVA, { ownership: null }), place)).toBe(true);
  });

  it("names the author, and a review session as one", () => {
    const name = (email: string) => email.split("@")[0]!;
    expect(authorLine({ author: ANA, role: "author" }, ANA, name)).toBe("You");
    expect(authorLine({ author: CYRIL, role: "review" }, ANA, name)).toBe("cyril · review session");
  });
});
