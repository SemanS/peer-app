import type {
  PeerHandoffPackage,
  PeerHubStatus,
  PeerPlansView,
  PeerProjectState,
  PeerTask,
  PeerTestReport,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  handoffPresentation,
  reviewFactsFrom,
  reviewPresentation,
  type ReviewFacts,
} from "./handoffPresentation";

const PACKAGE: PeerHandoffPackage = {
  number: 2,
  project: "app",
  task: "intake",
  title: "Import text PDFs",
  author: "ana@example.test",
  source: "agent",
  composedAt: "2026-10-22T08:00:00Z",
  context: null,
  inputs: [],
  overlaps: [],
  pullRequests: [],
};

describe("the handoff summary", () => {
  it("keeps shortened blocker coverage separate when no visible line reports a blocker", () => {
    const shown = handoffPresentation({
      ...PACKAGE,
      context: {
        version: 1,
        updatedAt: PACKAGE.composedAt,
        gist: null,
        sections: [{ name: "Blockers", shortened: true, lines: ["None for the import."] }],
        projectLines: [],
      },
    });
    expect(shown.blockers).toBeUndefined();
    expect(shown.blockersShortened).toBe(true);
  });
  it("does not raise attention for explicit no-blocker prose in a saved handoff", () => {
    const context = {
      version: 1,
      updatedAt: PACKAGE.composedAt,
      gist: null,
      sections: [
        {
          name: "Blockers",
          shortened: false,
          lines: ["None for the import. Feature tasks intentionally remain open."],
        },
      ],
      projectLines: [],
    } as const;
    const shown = handoffPresentation({ ...PACKAGE, context });
    expect(shown.blockers).toBeUndefined();
    expect(shown.sections).toEqual([]);
    const mixed = handoffPresentation({
      ...PACKAGE,
      context: {
        ...context,
        sections: [
          { name: "Blockers", shortened: false, lines: ["None.", "Waiting for approval."] },
        ],
      },
    });
    expect(mixed.blockers?.lines).toEqual(["Waiting for approval."]);
  });
  it("separates the result, blockers and next step from the full report without losing lines", () => {
    const sections = [
      { name: "Next", shortened: false, lines: ["Review the PR."] },
      { name: "State", shortened: false, lines: ["Agent reports local tests passed."] },
      { name: "Blockers", shortened: false, lines: ["CI did not run: spending limit."] },
      { name: "Decisions", shortened: false, lines: ["Keep the partner event IDs."] },
      { name: "Provides", shortened: true, lines: ["PDF import.", "Regression tests."] },
    ] as const;
    const shown = handoffPresentation({
      ...PACKAGE,
      context: {
        version: 1,
        updatedAt: PACKAGE.composedAt,
        gist: null,
        sections,
        projectLines: [],
      },
    });

    expect(shown.result?.lines).toEqual(["PDF import.", "Regression tests."]);
    expect(shown.blockers?.lines).toEqual(["CI did not run: spending limit."]);
    expect(shown.next?.lines).toEqual(["Review the PR."]);
    expect(shown.sections).toEqual(sections);
  });

  it("keeps every open overlap and stale or deleted input in the attention summary", () => {
    const overlaps = [
      { state: "settled", files: ["api.ts"], partner: null, at: PACKAGE.composedAt },
      { state: "open", files: ["schema.ts"], partner: null, at: PACKAGE.composedAt },
      { state: "open", files: ["docs.md"], partner: null, at: PACKAGE.composedAt },
    ] as const;
    const inputs = [
      { scope: "project", readVersion: 2, currentVersion: 2 },
      { scope: "task:other", readVersion: 3, currentVersion: 4 },
      { scope: "task:deleted", readVersion: 1, currentVersion: null },
    ];
    const shown = handoffPresentation({ ...PACKAGE, overlaps, inputs });

    expect(shown.openOverlaps).toEqual(overlaps.slice(1));
    expect(shown.changedInputs).toEqual(inputs.slice(1));
  });

  it("does not invent missing results or next steps and ignores empty sections", () => {
    const shown = handoffPresentation({
      ...PACKAGE,
      context: {
        version: 1,
        updatedAt: PACKAGE.composedAt,
        gist: null,
        sections: [{ name: "Blockers", shortened: false, lines: [" ", "- "] }],
        projectLines: [],
      },
    });

    expect(shown.sections).toEqual([]);
    expect(shown.result).toBeUndefined();
    expect(shown.next).toBeUndefined();
    expect(shown.blockers).toBeUndefined();
  });

  it("links only distinct, valid GitHub pull requests", () => {
    const url = "https://github.com/acme/app/pull/12";
    const shown = handoffPresentation({
      ...PACKAGE,
      pullRequests: [url, "javascript:alert(1)", url, "https://example.test/pull/2"],
    });

    expect(shown.pulls).toEqual([url]);
  });
});

const names: Record<string, string> = { "ana@example.test": "Ana", "slavo@example.test": "Slavo" };
const nameOf = (email: string) => names[email] ?? email;
const FACTS = { nameOf, computer: () => "Ana’s Mac" };

const REPORT: PeerTestReport = {
  project: "app",
  task: "intake",
  author: "ana@example.test",
  number: 3,
  result: "mixed",
  summary: "",
  role: "author",
  at: "2026-10-22T07:50:00Z",
  items: [
    ...Array.from({ length: 6 }, (_, index) => ({ kind: "pass" as const, text: `check ${index}` })),
    { kind: "unverified", text: "iPhone layout", task: "t31" },
    { kind: "unverified", text: "Screen reader" },
  ],
};

describe("the review page as a decision page", () => {
  it("asks for the decision with the policy's signals in words, before any prose", () => {
    const view = reviewPresentation(
      {
        ...PACKAGE,
        key: "1.1",
        policy: { mode: "ask", version: 2, signals: ["not-delivered", "unowned"], accepted: false },
        delivery: {
          state: "none",
          evidence: { untracked: ["a.ts", "b.ts"] },
          observedAt: PACKAGE.composedAt,
          environment: "env-ana",
          vcs: "git",
        },
        context: {
          version: 1,
          updatedAt: PACKAGE.composedAt,
          gist: null,
          sections: [
            {
              name: "Blockers",
              shortened: false,
              lines: ["SurveyConflictError (1.2) is a separate task"],
            },
            { name: "Next", shortened: false, lines: ["Wire the import into 3.1"] },
          ],
          projectLines: [],
        },
      },
      { ...FACTS, report: REPORT },
      (id) => (id === "t31" ? "3.1" : id),
    );

    expect(view.decision).toMatchObject({
      kind: "ask",
      text: "Accept 1.1? 2 signals: not-delivered, unowned",
      actions: ["done", "reopen"],
    });
    expect(view.verified.text).toBe("6 author-reported · 1 left to a task · 1 needs an owner");
    expect(view.delivered.text).toBe("none · 2 files untracked, Ana’s Mac");
    expect(view.evidence?.map((item) => item.mark).slice(-2)).toEqual([
      "left to 3.1",
      "needs an owner",
    ]);
    // The agent's blocker is its own note, under the disclosure that starts closed.
    expect(view.notesOpen).toBe(false);
    expect(view.notes.map((note) => note.title)).toEqual(["Blockers the agent named", "Next"]);
    // The classes hold Peer's facts only, and the agent's blocker is not among them.
    expect(view.signals.map((entry) => entry.signal)).toEqual(["not-delivered", "unowned"]);
    expect(view.groups.map((group) => group.label)).toEqual(["Agent action needed"]);
    expect(view.atHandoff).toBe(true);
  });

  it("says nobody is asked once the policy accepted it, and offers to withdraw that", () => {
    const view = reviewPresentation(
      {
        ...PACKAGE,
        policy: { mode: "auto", version: 3, signals: [], accepted: true },
      },
      { ...FACTS, acceptance: { by: "slavo@example.test", via: "policy" } },
    );
    expect(view.decision).toMatchObject({
      kind: "accepted-by-policy",
      text: "Accepted by policy v3 · waiting to land",
      actions: ["withdraw"],
    });
    expect(view.groups).toEqual([]);
  });

  it("follows the status over the package once an acceptance was withdrawn", () => {
    const pkg = { ...PACKAGE, acceptance: { by: "slavo@example.test", at: PACKAGE.composedAt } };
    expect(reviewPresentation(pkg, FACTS).decision?.text).toBe("Accepted by Slavo");
    expect(reviewPresentation(pkg, { ...FACTS, acceptance: null }).decision?.kind).toBe("ask");
  });

  it("states no decision on a done task and opens the agent's notes", () => {
    const view = reviewPresentation(PACKAGE, { ...FACTS, acceptance: null, status: "done" });
    expect(view.decision).toBeNull();
    expect(view.notesOpen).toBe(true);
  });

  it("falls back to the package's report counts and says a missing delivery was not observed", () => {
    const view = reviewPresentation(
      {
        ...PACKAGE,
        report: {
          number: 1,
          result: "pass",
          author: "ana@example.test",
          role: "author",
          at: PACKAGE.composedAt,
          passed: 2,
          failed: 0,
          unverified: 0,
          unowned: [],
        },
      },
      FACTS,
    );
    expect(view.verified).toMatchObject({
      text: "pass, 2 passed, 0 failed, 0 unverified",
      attention: false,
    });
    expect(view.evidence).toBeNull();
    expect(view.delivered.text).toBe("not observed");
    expect(reviewPresentation(PACKAGE, FACTS).verified.text).toBe("No test report");
  });

  it("keeps changed inputs and open overlaps under Needs attention", () => {
    const view = reviewPresentation(
      {
        ...PACKAGE,
        inputs: [{ scope: "task:x", readVersion: 1, currentVersion: 2 }],
        overlaps: [{ state: "open", files: ["a.ts"], partner: null, at: PACKAGE.composedAt }],
      },
      FACTS,
    );
    expect(view.changedInputs).toHaveLength(1);
    expect(view.openOverlaps).toHaveLength(1);
    expect(view.groups.map((group) => group.label)).toEqual(["Coordination needed"]);
  });
});

describe("who moves next on the review page", () => {
  const FACT = { ...FACTS, acceptance: null, status: "review" as const };
  const pkg = {
    ...PACKAGE,
    key: "1.1",
    source: "agent" as const,
    policy: { mode: "ask" as const, version: 2, signals: ["unowned" as const], accepted: false },
  };
  const live = (items: ReadonlyArray<object>, signals: ReadonlyArray<string> = []) =>
    ({
      available: true,
      signals: {
        evaluated: true,
        at: "t",
        signals,
        reports: [{ author: "a", role: "author", number: 1, result: "mixed", at: "t" }],
        handoff: { delivery: { state: "shared" } },
        items,
      },
    }) as unknown as NonNullable<ReviewFacts["live"]>;
  const base = { text: "x", author: "a", role: "author", number: 1, index: 0 };

  it("sorts three owners under their classes", () => {
    const view = reviewPresentation(pkg, {
      ...FACT,
      nameOf: () => "Ana",
      taskName: (id) => (id === "t31" ? "3.1" : id),
      live: live([
        { ...base, text: "malformed", kind: "fail", failed: true, task: "t31" },
        { ...base, text: "typecheck", kind: "unverified", failed: false },
        { ...base, text: "spec or design", kind: "unverified", failed: false, owner: "a" },
      ]),
    });
    expect(
      view.groups.map((group) => [group.label, group.steps.map((step) => [step.text, step.who])]),
    ).toEqual([
      ["Human decision needed", [["spec or design", "Ana’s"]]],
      ["Coordination needed", [["malformed", "left to 3.1"]]],
      ["Agent action needed", [["typecheck", null]]],
    ]);
    expect(view.decision?.text).toBe("Human decision needed");
  });

  it("says With the agent while the run is live, and offers Continue once it ended", () => {
    const facts = {
      ...FACT,
      live: live([{ ...base, kind: "unverified", failed: false }], ["unowned"]),
    };
    const running = reviewPresentation(pkg, { ...facts, runLive: true });
    expect(running.decision?.text).toBe("With the agent");
    expect(running.decision?.actions).toContain("done");
    expect(running.agentStopped).toBe(false);
    const ended = reviewPresentation(pkg, { ...facts, runLive: false });
    expect(ended.decision?.text).toBe("Accept 1.1? 1 signal: unowned");
    expect(ended.agentStopped).toBe(true);
  });

  it("no longer counts a signal cleared since, and says it was raised at handoff", () => {
    const view = reviewPresentation(pkg, { ...FACT, live: live([]) });
    expect(view.decision?.text).toBe("Accept 1.1? No signals");
    expect(view.raisedAtHandoff.map((entry) => entry.signal)).toEqual(["unowned"]);
    expect(view.atHandoff).toBe(false);
    expect(view.groups).toEqual([]);
  });

  it("keeps the package's signals labelled at handoff when the Hub cannot say", () => {
    const view = reviewPresentation(pkg, { ...FACT, live: { available: false } });
    expect(view.atHandoff).toBe(true);
    expect(view.decision?.text).toBe("Accept 1.1? 1 signal: unowned");
  });

  it("drops a package's overlap and input the Hub no longer holds open", () => {
    const view = reviewPresentation(
      {
        ...pkg,
        overlaps: [{ state: "open", files: ["a"], partner: null, at: "t" }],
        inputs: [{ scope: "task:x", readVersion: 1, currentVersion: 2 }],
      },
      { ...FACT, live: live([]) },
    );
    expect(view.openOverlaps).toEqual([]);
    expect(view.changedInputs).toEqual([]);
  });

  it("claims no handoff after a person's move", () => {
    const view = reviewPresentation(pkg, {
      ...FACT,
      live: { available: true, signals: { evaluated: false, at: "t", signals: [] } },
    });
    expect(view.groups).toEqual([]);
    expect(view.decision?.signals).toEqual([]);
  });
});

describe("what the review page adds to a package", () => {
  const task = (id: string, status: PeerTask["status"], description?: string): PeerTask => ({
    id,
    key: id,
    title: id,
    status,
    createdAt: "",
    updatedAt: "",
    createdBy: "ana@example.test",
    ...(description === undefined ? {} : { description }),
  });
  const state = {
    project: { id: "app", name: "App", role: "member", members: [] },
    work: {
      tasks: [
        task("intake", "review", "Import PDFs\n- Outcome: text PDFs import as receipts"),
        task("1.2", "open"),
        task("3.1", "open"),
        task("5.1", "open"),
      ],
      threads: [],
    },
  } as unknown as PeerProjectState;
  const status = (accepted?: { via?: "policy"; beforeReopening?: boolean }) =>
    ({
      environmentId: "env-here",
      email: "slavo@example.test",
      handoff: { target: "none", projectTargets: {}, summaries: [], deliveries: [] },
      acceptance: {
        accepted:
          accepted === undefined
            ? []
            : [
                {
                  workspace: "acme",
                  project: "app",
                  task: "intake",
                  by: "slavo@example.test",
                  at: PACKAGE.composedAt,
                  statusThen: "review",
                  ...accepted,
                },
              ],
      },
      dependencies: [
        {
          workspace: "acme",
          available: true,
          projects: { app: { "3.1": ["intake", "1.2"], "5.1": ["intake"] } },
        },
      ],
    }) as unknown as PeerHubStatus;
  const input = (hub: PeerHubStatus, plans?: PeerPlansView) => ({
    pkg: PACKAGE,
    status: hub,
    workspace: "acme",
    state,
    nameOf,
    plans,
  });

  it("names who waits, the brief's outcome without a plan, and the acceptance as the status says it", () => {
    const facts = reviewFactsFrom(input(status({ via: "policy" })));
    expect(facts.dependents?.map((group) => group.line)).toEqual([
      "3.1 · ready when 1.2 also lands",
      "5.1 · ready",
    ]);
    expect(facts.briefOutcome).toBe("text PDFs import as receipts");
    expect(facts.planLines).toEqual([]);
    expect(facts.acceptance).toEqual({ by: "slavo@example.test", via: "policy" });
    expect(facts.status).toBe("review");
    expect(facts.computer("env-here")).toBe("this computer");
    expect(facts.computer("env-other")).toBe("Ana’s computer");
  });

  it("reads an acceptance given before reopening as none, and none at all without acceptance", () => {
    expect(reviewFactsFrom(input(status({ beforeReopening: true }))).acceptance).toBeNull();
    const { acceptance: _off, ...withoutAcceptance } = status();
    expect(
      reviewFactsFrom(input(withoutAcceptance as unknown as PeerHubStatus)).acceptance,
    ).toBeUndefined();
  });

  it("takes the provides lines of the author's newest plan on the task", () => {
    const plan = (email: string, updatedAt: string, contract: string) => ({
      project: "app",
      session: "s",
      email,
      environment: "env",
      task: "intake",
      label: "",
      seq: 1,
      version: 1,
      changes: [],
      maybes: [],
      uses: [],
      provides: [{ name: "importPdf", path: "src/import.ts", contract }],
      declaredAt: updatedAt,
      updatedAt,
      live: false,
    });
    const plans = {
      plans: [
        plan("ana@example.test", "2026-10-22T07:00:00Z", "old"),
        plan("ana@example.test", "2026-10-22T07:30:00Z", "returns a receipt"),
        plan("bob@example.test", "2026-10-22T07:40:00Z", "not Ana's"),
      ],
    } as unknown as PeerPlansView;
    expect(reviewFactsFrom(input(status(), plans)).planLines).toEqual([
      "importPdf (src/import.ts): returns a receipt",
    ]);
  });
});
