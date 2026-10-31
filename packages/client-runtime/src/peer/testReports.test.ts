import type { PeerHubStatus, PeerTestReport, PeerTestReportSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canAssignOwners,
  draftItems,
  draftOf,
  handoffReportLine,
  itemMark,
  markDisagrees,
  newestSummary,
  orderedReports,
  ownReport,
  reportBadge,
  reportCounts,
  staleOwnerLine,
  teamFact,
  testReportsRevision,
} from "./testReports.ts";
import { governingSummaries, inheritedRows } from "./testReports.ts";

const ANA = "ana@acme.test";
const SLAVO = "slavo@acme.test";
const CYRIL = "cyril@acme.test";
const PLACE = { workspace: "acme", project: "ordering", task: "vl7" };

const summary = (over: Partial<PeerTestReportSummary>): PeerTestReportSummary => ({
  ...PLACE,
  author: ANA,
  number: 1,
  result: "mixed",
  role: "author",
  at: "2026-10-28T10:00:00Z",
  passed: 1,
  failed: 0,
  unverified: 1,
  unowned: 1,
  ...over,
});

const report = (over: Partial<PeerTestReport>): PeerTestReport => ({
  project: PLACE.project,
  task: PLACE.task,
  author: ANA,
  number: 2,
  result: "mixed",
  summary: "Unit tests pass; the phone was not checked",
  items: [
    {
      kind: "pass",
      text: "cargo test features::handoff",
      seen: { failed: false, at: "2026-10-28T14:02:00Z" },
    },
    { kind: "unverified", text: "iPhone layout of the task page" },
  ],
  role: "author",
  at: "2026-10-28T14:05:00Z",
  ...over,
});

const statusWith = (summaries: PeerTestReportSummary[]) =>
  ({ testReports: { summaries } }) as Pick<PeerHubStatus, "testReports">;

describe("the task row and the Team page", () => {
  it("names the result and how many unverified items wait for an owner", () => {
    expect(reportBadge({ result: "mixed", unowned: 1 })).toBe(
      "Tests: mixed · 1 item needs an owner",
    );
    expect(reportBadge({ result: "mixed", unowned: 2 })).toBe(
      "Tests: mixed · 2 items need an owner",
    );
    expect(reportBadge({ result: "pass", unowned: 0 })).toBe("Tests: pass");
    expect(teamFact({ result: "mixed", unowned: 1 })).toEqual({
      text: "Tests: mixed · 1 unverified item needs an owner",
      needsOwner: true,
    });
    expect(teamFact({ result: "fail", unowned: 0 })).toEqual({
      text: "Tests: fail",
      needsOwner: false,
    });
  });

  it("reads the newest report of the task from the status, and moves its revision with owners", () => {
    const older = summary({ author: SLAVO, at: "2026-10-28T09:00:00Z", unowned: 0 });
    const newer = summary({});
    const elsewhere = summary({ task: "vl8", at: "2026-10-28T12:00:00Z" });
    const status = statusWith([older, elsewhere, newer]);
    expect(newestSummary(status, PLACE)).toBe(newer);
    expect(newestSummary(statusWith([]), PLACE)).toBeUndefined();
    expect(newestSummary({} as Pick<PeerHubStatus, "testReports">, PLACE)).toBeUndefined();
    const before = testReportsRevision(status, PLACE);
    expect(
      testReportsRevision(statusWith([older, elsewhere, { ...newer, unowned: 0 }]), PLACE),
    ).not.toBe(before);
    expect(testReportsRevision(statusWith([newer, older]), PLACE)).toBe(before);
  });
});

describe("an item's mark", () => {
  const clock = (at: string) => at.slice(11, 16);

  it("says Peer saw the command run, or that the author reports it", () => {
    const [seen, unverified] = report({}).items;
    expect(itemMark(seen!, clock)).toBe("seen run by Peer, passed, 14:02");
    expect(itemMark({ kind: "pass" }, clock)).toBe("author-reported");
    expect(itemMark(unverified!, clock)).toBeNull();
  });

  it("says a claimed pass Peer saw fail failed", () => {
    const item = {
      kind: "pass" as const,
      seen: { failed: true, at: "2026-10-28T14:02:00Z" },
    };
    expect(itemMark(item, clock)).toBe("seen run by Peer, failed, 14:02");
    expect(markDisagrees(item)).toBe(true);
    expect(markDisagrees({ kind: "fail", seen: { failed: true, at: item.seen.at } })).toBe(false);
  });
});

describe("who gives unverified items an owner", () => {
  const workspace = (role: "member" | "admin" | "owner") => ({ slug: "acme", role });
  const project = (role: "lead" | "member") => ({
    id: "ordering",
    role,
    members: [ANA, SLAVO, CYRIL].map((email) => ({ email, name: email.split("@")[0]! })),
  });
  const owned = (me: string) =>
    ({
      email: me,
      ownership: {
        projects: [
          {
            workspace: "acme",
            project: "ordering",
            at: "2026-10-28T10:00:00Z",
            leads: [],
            tasks: { vl7: { owner: ANA, since: "2026-10-28T10:00:00Z", reason: "named" } },
            map: { version: 0, areas: {}, paths: {}, decide: [] },
            calls: [],
          },
        ],
      },
    }) as unknown as Pick<PeerHubStatus, "ownership" | "email">;

  it("lets the task's owner, a lead and an admin, and nobody else", () => {
    expect(canAssignOwners(owned(ANA), workspace("member"), project("member"), { id: "vl7" })).toBe(
      true,
    );
    expect(
      canAssignOwners(owned(CYRIL), workspace("member"), project("member"), { id: "vl7" }),
    ).toBe(false);
    expect(canAssignOwners(owned(CYRIL), workspace("member"), project("lead"), { id: "vl7" })).toBe(
      true,
    );
    expect(
      canAssignOwners(owned(CYRIL), workspace("admin"), project("member"), { id: "vl7" }),
    ).toBe(true);
  });

  it("leaves it to leads and admins while ownership is not known", () => {
    const none = { email: ANA } as Pick<PeerHubStatus, "ownership" | "email">;
    expect(canAssignOwners(none, workspace("member"), project("member"), { id: "vl7" })).toBe(
      false,
    );
    expect(canAssignOwners(none, workspace("member"), project("lead"), { id: "vl7" })).toBe(true);
  });
});

describe("a person's own report", () => {
  it("is found by address, and its form starts from it", () => {
    const mine = report({
      items: [
        { kind: "pass", text: "vp test run x.test.ts" },
        { kind: "unverified", text: "iPhone layout", owner: SLAVO },
      ],
    });
    const theirs = report({ author: SLAVO });
    expect(ownReport([theirs, mine], "ANA@acme.test")).toBe(mine);
    expect(ownReport([theirs], ANA)).toBeUndefined();
    expect(ownReport([mine], null)).toBeUndefined();
    const draft = draftOf(mine);
    expect(draft.unverified).toBe(`iPhone layout @${SLAVO}`);
    expect(draftItems(draft)).toEqual([
      { kind: "pass", text: "vp test run x.test.ts" },
      { kind: "unverified", text: "iPhone layout", owner: SLAVO },
    ]);
    expect(draftOf(undefined).result).toBe("pass");
  });

  it("takes one item per line and an owner at the end of an unverified line", () => {
    expect(
      draftItems({
        result: "mixed",
        summary: "s",
        passed: " a \n\n b ",
        failed: "c",
        unverified: "phone layout @slavo\nsafari",
      }),
    ).toEqual([
      { kind: "pass", text: "a" },
      { kind: "pass", text: "b" },
      { kind: "fail", text: "c" },
      { kind: "unverified", text: "phone layout", owner: "slavo" },
      { kind: "unverified", text: "safari" },
    ]);
  });
});

describe("reports on a page", () => {
  it("lists the newest first and counts items as the status does", () => {
    const a = report({ at: "2026-10-28T09:00:00Z", author: SLAVO });
    const b = report({});
    expect(orderedReports([a, b])).toEqual([b, a]);
    expect(reportCounts(b)).toEqual({ passed: 1, failed: 0, unverified: 1, unowned: 1 });
  });

  it("names the newer report when an owner's save was stale", () => {
    expect(staleOwnerLine({ kind: "stale", number: 3 })).toContain("report 3");
    expect(staleOwnerLine({ kind: "saved", report: report({}) })).toBeNull();
  });
});

describe("the report in a handoff package", () => {
  const carried = {
    number: 1,
    result: "mixed" as const,
    author: ANA,
    role: "author",
    at: "2026-10-28T14:05:00Z",
    passed: 1,
    failed: 0,
    unverified: 1,
    unowned: ["iPhone layout"],
  };

  it("names the result, the counts and the items without an owner", () => {
    expect(handoffReportLine(carried)).toBe(
      "Tests: mixed, 1 passed, 0 failed, 1 unverified · 'iPhone layout' needs an owner",
    );
    expect(handoffReportLine({ ...carried, unowned: ["a", "b"], unverified: 2 })).toBe(
      "Tests: mixed, 1 passed, 0 failed, 2 unverified · 'a', 'b' need an owner",
    );
    expect(handoffReportLine({ ...carried, unowned: [] })).toBe(
      "Tests: mixed, 1 passed, 0 failed, 1 unverified",
    );
    expect(handoffReportLine(undefined)).toBeNull();
  });
});

describe("governingSummaries", () => {
  const summary = (author: string, role: string, at: string) => ({
    workspace: "w",
    project: "p",
    task: "t",
    author,
    number: 1,
    result: "pass" as const,
    role,
    at,
    passed: 1,
    failed: 0,
    unverified: 0,
    unowned: 0,
  });
  it("keeps the newest of each role", () => {
    const rows = governingSummaries(
      {
        testReports: {
          summaries: [
            summary("a", "author", "2026-10-01T00:00:00Z"),
            summary("b", "author", "2026-10-02T00:00:00Z"),
            summary("r", "review", "2026-09-01T00:00:00Z"),
          ],
        },
      },
      { workspace: "w", project: "p", task: "t" },
    );
    expect(rows.map((row) => row.author)).toEqual(["b", "r"]);
  });
});

describe("inheritedRows", () => {
  it("names each item with its source task and report", () => {
    const rows = inheritedRows(
      {
        items: [
          {
            task: "t1",
            key: "1.1",
            title: "Contract",
            author: "ana@acme.test",
            role: "author",
            number: 2,
            index: 0,
            kind: "fail",
            text: "malformed revision",
            failed: true,
            at: "t",
          },
        ],
        capped: false,
      },
      () => "Ana",
    );
    expect(rows).toEqual([
      {
        key: "t1:ana@acme.test:2:0",
        kind: "failed",
        text: "malformed revision",
        source: "From 1.1 · report 2 · Ana",
      },
    ]);
  });
});
