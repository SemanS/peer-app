import type { PeerTestReport, PeerTestReportSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { authorRoleLabel, filedAt, reportViews, summaryLines } from "./testReports.logic";

const members = [
  { email: "ana@acme.test", name: "Ana" },
  { email: "slavo@acme.test", name: "Slavo" },
];

const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m, d, h, min).toISOString();

const report = (extra: Partial<PeerTestReport> = {}): PeerTestReport => ({
  project: "shop",
  task: "VL7",
  author: "ana@acme.test",
  number: 1,
  result: "mixed",
  summary: "Unit tests pass; the phone was not checked",
  items: [
    {
      kind: "pass",
      text: "cargo test features::handoff",
      seen: { failed: false, at: local(2026, 9, 28, 14, 2) },
    },
    { kind: "pass", text: "manual check of the login flow" },
    { kind: "unverified", text: "iPhone layout of the task page", owner: "slavo@acme.test" },
    { kind: "unverified", text: "Android layout" },
  ],
  role: "author",
  at: local(2026, 9, 28, 14, 5),
  ...extra,
});

const now = new Date(2026, 9, 28, 16, 0).getTime();

describe("what is left to a task on the phone", () => {
  it("says which task carries an item, and needs no owner for it", () => {
    const [view] = reportViews(
      [
        report({
          items: [
            { kind: "fail", text: "malformed revision", task: "t31" },
            { kind: "fail", text: "login" },
            { kind: "unverified", text: "actions", task: "t31" },
          ],
        }),
      ],
      { members, me: null, now: 0, taskName: () => "3.1" },
    );
    expect(view?.items.map((item) => [item.owner, item.needsOwner])).toEqual([
      ["Left to 3.1", false],
      [null, false],
      ["Left to 3.1", false],
    ]);
  });
});

describe("a task's reports on the phone", () => {
  it("shows a report's result, author, role, time and counts", () => {
    const [view] = reportViews([report()], { members, me: null, now });
    expect(view).toMatchObject({
      heading: "Tests: mixed · 1 item needs an owner",
      byline: "Report 1 · Ana · author · 14:05",
      counts: "2 passed · 0 failed · 2 unverified",
      shortened: false,
    });
  });

  it("marks what Peer saw run apart from what the author reports, and gives owners", () => {
    const [view] = reportViews([report()], { members, me: "slavo@acme.test", now });
    expect(view?.items.map((item) => [item.kindLabel, item.mark, item.owner])).toEqual([
      ["Passed", "seen run by Peer, passed, 14:02", null],
      ["Passed", "author-reported", null],
      ["Unverified", null, "Owner: You"],
      ["Unverified", null, "Needs an owner"],
    ]);
    expect(view?.items.map((item) => item.needsOwner)).toEqual([false, false, false, true]);
  });

  it("flags a pass Peer saw fail", () => {
    const [view] = reportViews(
      [
        report({
          items: [
            {
              kind: "pass",
              text: "vp test run x.test.ts",
              seen: { failed: true, at: local(2026, 9, 28, 9, 30) },
            },
          ],
        }),
      ],
      { members, me: null, now },
    );
    expect(view?.items[0]).toMatchObject({
      mark: "seen run by Peer, failed, 09:30",
      disagrees: true,
    });
  });

  it("lists every author's report newest first, a review session's by its role", () => {
    const views = reportViews(
      [
        report(),
        report({
          author: "slavo@acme.test",
          number: 2,
          role: "review",
          result: "pass",
          items: [],
          at: local(2026, 9, 27, 18, 40),
          shortened: true,
        }),
        report({ author: "cyril@acme.test", number: 3, at: local(2026, 9, 28, 15, 0) }),
      ],
      { members, me: null, now },
    );
    expect(views.map((view) => view.byline)).toEqual([
      "Report 3 · cyril@acme.test · author · 15:00",
      "Report 1 · Ana · author · 14:05",
      "Report 2 · Slavo · review session · Oct 27, 18:40",
    ]);
    expect(views[2]?.shortened).toBe(true);
  });

  it("says when a report was filed in the reader's day, and nothing for a bad time", () => {
    expect(filedAt(local(2026, 9, 28, 8, 7), now)).toBe("08:07");
    expect(filedAt(local(2026, 0, 3, 23, 59), now)).toBe("Jan 3, 23:59");
    expect(filedAt("not a time", now)).toBe("");
    expect(authorRoleLabel("auditor")).toBe("auditor");
  });

  it("reads the status's summaries while the reports load", () => {
    const summary: PeerTestReportSummary = {
      workspace: "acme",
      project: "shop",
      task: "VL7",
      author: "ana@acme.test",
      number: 2,
      result: "fail",
      role: "author",
      at: local(2026, 9, 28, 14, 5),
      passed: 1,
      failed: 1,
      unverified: 2,
      unowned: 2,
    };
    expect(summaryLines([summary], members, null)).toEqual([
      { key: "ana@acme.test:2", text: "Tests: fail · 2 items need an owner · Ana" },
    ]);
  });
});
