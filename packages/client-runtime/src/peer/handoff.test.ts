import { describe, expect, it } from "vite-plus/test";
import fixture from "../../../contracts/src/peer/handoff.fixture.json" with { type: "json" };
import * as Schema from "effect/Schema";
import { PeerHandoffPackage } from "@t3tools/contracts";
import {
  canHandOff,
  contextMovedOn,
  contextMovedLine,
  contextWritten,
  currentContextVersion,
  handoffLines,
  handoffLineText,
  inputLabel,
  inputState,
  isEarlierHandoff,
  packageRows,
  outcomeText,
  handoffRevision,
  shortenedNote,
  decisionLine,
  deliveredChip,
  providesChip,
  pullRequestName,
  verifiedChip,
  HANDOFF_RULES,
  handoffNextSteps,
  handoffRule,
  liveHandoffFacts,
  packageHandoffFacts,
  statusHandoffFacts,
  type HandoffFact,
} from "./handoff.ts";
import type {
  PeerHandoffDelivery,
  PeerHandoffSignals,
  PeerHubStatus,
  PeerTestReportItem,
} from "@t3tools/contracts";
const p = Schema.decodeUnknownSync(PeerHandoffPackage)(fixture);
describe("reviewer facts", () => {
  it("offers any own harness, hides done/other people's work and shows earlier contexts", () => {
    const thread = { task: "a", email: "ana" };
    expect(canHandOff({ id: "a", status: "open" }, [thread], "ana")).toBe("Hand off for review");
    expect(canHandOff({ id: "a", status: "review" }, [thread], "ana")).toBe("Update handoff");
    expect(canHandOff({ id: "a", status: "done" }, [thread], "ana")).toBeNull();
    expect(canHandOff({ id: "a", status: "open" }, [thread], "ben")).toBeNull();
    expect(isEarlierHandoff({ status: "open" })).toBe(true);
    expect(packageRows(p).join("\n")).toContain("changed since read");
    expect(
      packageRows({ ...p, overlaps: p.overlaps.filter((o) => o.state === "open") }).join("\n"),
    ).not.toContain("they rename first");
  });
  it("invalidates when any author's package changes without relying on the largest number", () => {
    const first = [{ author: "ana", number: 2 }];
    expect(handoffRevision(first)).not.toBe(
      handoffRevision([...first, { author: "ben", number: 1 }]),
    );
    expect(handoffRevision([...first, { author: "ben", number: 1 }])).not.toBe(
      handoffRevision([...first, { author: "ben", number: 2 }]),
    );
    expect(handoffRevision(first, 1)).not.toBe(handoffRevision(first));
  });
  it("keeps outcomes on one line", () => {
    const lines = outcomeText({
      workspace: "a",
      project: "a",
      task: "a",
      stored: true,
      number: 2,
      contextVersion: 7,
      changed: false,
      notices: ["one\ntwo"],
      targets: [{ url: "https://github.com/o/r/pull/1", kind: "failed", reason: "signed out" }],
    });
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
  });
});
describe("handoff lines", () => {
  it("lose one leading bullet and keep the markdown", () => {
    expect(handoffLineText("- `src/print/receipt.ts` prints the header")).toBe(
      "`src/print/receipt.ts` prints the header",
    );
    expect(handoffLineText("* a")).toBe("a");
    expect(handoffLineText("• a")).toBe("a");
    expect(handoffLineText("  -   spaced out  ")).toBe("spaced out");
    expect(handoffLineText("- - nested")).toBe("- nested");
  });
  it("keep text that only looks like a bullet", () => {
    expect(handoffLineText("-1 degree")).toBe("-1 degree");
    expect(handoffLineText("**bold** first")).toBe("**bold** first");
    expect(handoffLineText("*emphasis* first")).toBe("*emphasis* first");
    expect(handoffLineText("1. first")).toBe("1. first");
    expect(handoffLineText("plain")).toBe("plain");
  });
  it("show no empty bullet and key repeated lines apart", () => {
    expect(handoffLines(["- a", "-", "   ", "- a", "b"])).toEqual([
      { id: "- a:0", text: "a" },
      { id: "- a:1", text: "a" },
      { id: "b:0", text: "b" },
    ]);
  });
  it("say where the rest of a shortened section is", () => {
    expect(shortenedNote()).toBe("Peer keeps 8 lines per section; the rest is in the chat.");
    expect(shortenedNote("Ana")).toBe(
      "Peer keeps 8 lines per section; the rest is in Ana’s chat, on their computer.",
    );
  });
});
describe("the task context moved on", () => {
  it("is the version the handoff was built from and the one there is now", () => {
    expect(contextMovedOn(p, 9)).toEqual({ read: 7, latest: 9, context: "task:krk-335" });
    expect(contextMovedOn(p, null)).toEqual({ read: 7, latest: null, context: "task:krk-335" });
    expect(contextMovedOn(p, 7)).toBeNull();
    expect(contextMovedOn({ ...p, context: null }, 9)).toBeNull();
  });
  it("is not claimed where this computer cannot see contexts, since none would look absent", () => {
    const context = (version: number) => ({
      workspace: "acme",
      project: "shop",
      scope: "task:krk-335",
      version,
      updatedAt: "2026-10-15T10:00:00Z",
      bytes: 10,
    });
    const place = { workspace: "acme", projectId: "shop", taskId: "krk-335" };
    const on = (contexts: ReturnType<typeof context>[]) => ({ enabled: true, contexts });
    expect(currentContextVersion(on([context(9)]), place)).toBe(9);
    expect(currentContextVersion(on([]), place)).toBeNull();
    expect(currentContextVersion(on([{ ...context(9), project: "other" }]), place)).toBeNull();
    // Coordination off: the contexts list is empty because nothing reads it, not because they are gone.
    const off = currentContextVersion({ enabled: false, contexts: [] }, place);
    expect(off).toBeUndefined();
    expect(contextMovedOn(p, off)).toBeNull();
    expect(contextMovedLine(p, off)).toBeNull();
  });
  it("reads as a sentence where there is no banner", () => {
    expect(contextMovedLine(p, 9)).toBe(
      "The task context changed after this handoff: it was built from v7, the latest is v9.",
    );
    expect(contextMovedLine(p, null)).toBe(
      "The task context changed after this handoff: it was built from v7 and no longer exists.",
    );
    expect(contextMovedLine(p, 7)).toBeNull();
  });
  it("says who wrote the latest version", () => {
    const name = (email: string) => (email === "ana@acme.test" ? "Ana" : "a teammate");
    const me = "ben@acme.test";
    expect(
      contextWritten({ updatedBy: "ana@acme.test", updatedSession: "claude:1" }, name, me),
    ).toBe("written by Ana’s agent");
    expect(contextWritten({ updatedBy: me, updatedSession: "claude:1" }, name, me)).toBe(
      "written by your agent",
    );
    expect(contextWritten({ updatedBy: "ana@acme.test", restoredFrom: 2 }, name, me)).toBe(
      "restored from v2 by Ana",
    );
    expect(contextWritten({ updatedBy: me, restoredFrom: 2 }, name, me)).toBe(
      "restored from v2 by you",
    );
    expect(contextWritten({}, name, me)).toBe("");
    expect(contextWritten(undefined, name, null)).toBe("");
  });
  it("tells an input that is current from one that changed or is gone", () => {
    const [task, project] = p.inputs;
    expect(inputLabel(task!)).toBe("KRK-310 task context");
    expect(inputState(task!)).toBe("current");
    expect(inputLabel(project!)).toBe("Project context");
    expect(inputState(project!)).toBe("changed");
    expect(inputLabel({ scope: "task:x", title: "Resolver cache" })).toBe(
      "Resolver cache task context",
    );
    expect(inputState({ readVersion: 2, currentVersion: null })).toBe("gone");
  });
});

describe("the review page's decision line", () => {
  const pkg = { task: "t-11", key: "1.1" } as const;
  const policy = (signals: ReadonlyArray<"not-delivered" | "unowned">, accepted = false) => ({
    mode: "auto" as const,
    version: 3,
    signals,
    accepted,
  });

  it("asks the person with the signals named, and offers Mark done and Reopen", () => {
    const line = decisionLine({ ...pkg, policy: policy(["not-delivered", "unowned"]) });
    expect(line.text).toBe("Accept 1.1? 2 signals: not-delivered, unowned");
    expect(line.kind).toBe("ask");
    expect(line.actions).toEqual(["done", "reopen"]);
    expect(decisionLine({ ...pkg, policy: { ...policy([]), mode: "ask" } }).text).toBe(
      "Accept 1.1? No signals",
    );
    // A package from an older Hub has no policy: the question alone.
    expect(decisionLine(pkg).text).toBe("Accept 1.1?");
  });

  it("says nobody is asked when the policy accepted it, and offers Withdraw", () => {
    const line = decisionLine({
      ...pkg,
      policy: policy([], true),
      acceptance: { by: "ana@acme.test", at: "2026-10-30T09:00:00Z", via: "policy" },
    });
    expect(line).toEqual({
      kind: "accepted-by-policy",
      text: "Accepted by policy v3 · waiting to land",
      signals: [],
      actions: ["withdraw"],
      raisedAtHandoff: [],
    });
  });

  it("names the lead of a hand-made acceptance, and reads the current one over the package's", () => {
    const nameOf = (email: string) => (email === "ana@acme.test" ? "Ana" : email);
    expect(decisionLine(pkg, { by: "ana@acme.test" }, { status: "done", nameOf }).text).toBe(
      "Accepted by Ana",
    );
    const withdrawn = decisionLine(
      { ...pkg, acceptance: { by: "ana@acme.test", at: "x", via: "policy" } },
      null,
    );
    expect(withdrawn.kind).toBe("ask");
    expect(decisionLine(pkg, null, { status: "done" })).toEqual({
      kind: "done",
      text: "Done",
      signals: [],
      actions: [],
      raisedAtHandoff: [],
    });
  });
});

describe("the review page's chips", () => {
  const item = (overrides: Partial<PeerTestReportItem>): PeerTestReportItem => ({
    kind: "pass",
    text: "check",
    ...overrides,
  });

  it("counts Verified by provenance", () => {
    const chip = verifiedChip({
      items: [
        ...Array.from({ length: 6 }, () => item({})),
        item({ kind: "unverified", task: "3.1" }),
        item({ kind: "unverified" }),
      ],
    });
    expect(chip.text).toBe("6 author-reported · 1 left to a task · 1 needs an owner");
    expect(chip.attention).toBe(true);
    const clean = verifiedChip({
      items: [
        item({ seen: { failed: false, at: "2026-10-30T09:00:00Z" } }),
        item({}),
        item({ kind: "unverified", owner: "ben@acme.test" }),
      ],
    });
    expect(clean.text).toBe("1 seen run by Peer · 1 author-reported · 1 with an owner");
    expect(clean.attention).toBe(false);
    expect(verifiedChip({ items: [item({ kind: "fail" })] }).text).toBe("1 failed");
    expect(verifiedChip(undefined)).toEqual({
      text: "No test report",
      counts: undefined,
      attention: true,
    });
  });

  const names = { computer: (env: string) => (env === "env-mac" ? "Slavo's Mac" : env) };
  const delivery = (
    state: PeerHandoffDelivery["state"],
    evidence: PeerHandoffDelivery["evidence"],
    vcs: PeerHandoffDelivery["vcs"] = "git",
  ): PeerHandoffDelivery => ({
    state,
    evidence,
    observedAt: "2026-10-30T09:00:00Z",
    environment: "env-mac",
    vcs,
  });

  it("says Delivered with where, and on which computer Peer saw it", () => {
    const none = deliveredChip(
      delivery("none", { untracked: ["a.ts", "b.ts"], branch: "feature/x" }),
      names,
    );
    expect(none.text).toBe("none · 2 files untracked, Slavo's Mac");
    expect(none.observed).toBe("as Peer saw it on Slavo's Mac");
    expect(none.attention).toBe(true);
    expect(
      deliveredChip(delivery("none", { untracked: ["a.ts"], uncommitted: ["c.ts"] }), names).text,
    ).toBe("none · 1 file untracked, 1 uncommitted, Slavo's Mac");
    expect(deliveredChip(delivery("local", { branch: "feature/x" }), names).text).toBe(
      "local · feature/x, not pushed, Slavo's Mac",
    );
    const shared = deliveredChip(
      delivery("shared", {
        branch: "feature/x",
        pullRequests: ["https://github.com/acme/app/pull/12"],
      }),
      names,
    );
    expect(shared.text).toBe("shared · feature/x, PR #12");
    expect(shared.attention).toBe(false);
    expect(
      deliveredChip(
        delivery("shared", { bookmarks: ["peer/1.1"], changes: ["kxqpmnzswtyvlrou"] }, "jj"),
        names,
      ).text,
    ).toBe("shared · peer/1.1, kxqpmnzs");
    expect(deliveredChip(delivery("landed", { commit: "0123456789abcdef" }), names).text).toBe(
      "landed · 01234567",
    );
    expect(deliveredChip(undefined, names)).toEqual({
      state: "not-observed",
      text: "not observed",
      observed: null,
      attention: true,
    });
    expect(pullRequestName("https://example.test/mr/4")).toBe("https://example.test/mr/4");
  });

  it("says Provides from the plan, else the brief, with who waits", () => {
    const waiting = [{ line: "3.1, 3.2 · ready when 1.2 also lands" }, { line: "5.1 · ready" }];
    expect(providesChip(["SurveyLock type", " "], "Locks surveys", waiting)).toEqual({
      source: "plan",
      lines: ["SurveyLock type"],
      waiting: ["3.1, 3.2 · ready when 1.2 also lands", "5.1 · ready"],
    });
    expect(providesChip([], "Locks surveys", []).lines).toEqual(["Locks surveys"]);
    expect(providesChip([], null, []).source).toBe("none");
  });
});

describe("handoffNextSteps", () => {
  // Every case of docs/decision-model/examples.yaml in the Hub repository.
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly facts: ReadonlyArray<HandoffFact>;
    readonly expect: {
      readonly headline: "agent_action" | "coordination" | "human_decision" | null;
      readonly agent_action: number;
      readonly coordination: number;
      readonly human_decision: number;
      readonly covered: number;
    };
  }> = [
    {
      name: "formbricks 1.1 as filed",
      facts: [
        { fact: "report", exists: true },
        { fact: "delivery", state: "shared" },
        { fact: "failed_item", home: "none", label: "Malformed base revision" },
        { fact: "unverified_item", answered_by: "nobody", label: "full typecheck" },
        { fact: "unverified_item", answered_by: "nobody", label: "D3 or CE spec" },
        { fact: "unverified_item", answered_by: "task", label: "integration with actions" },
      ],
      expect: {
        headline: "agent_action",
        agent_action: 3,
        coordination: 0,
        human_decision: 0,
        covered: 1,
      },
    },
    {
      name: "formbricks 1.1 after the agent sorted it",
      facts: [
        { fact: "report", exists: true },
        { fact: "delivery", state: "shared" },
        { fact: "failed_item", home: "dependent_task", label: "Malformed base revision" },
        { fact: "unverified_item", answered_by: "person", label: "D3 or CE spec" },
        { fact: "unverified_item", answered_by: "task", label: "integration with actions" },
      ],
      expect: {
        headline: "human_decision",
        agent_action: 0,
        coordination: 1,
        human_decision: 1,
        covered: 1,
      },
    },
    {
      name: "clean handoff",
      facts: [
        { fact: "report", exists: true },
        { fact: "delivery", state: "shared" },
      ],
      expect: { headline: null, agent_action: 0, coordination: 0, human_decision: 0, covered: 0 },
    },
    {
      name: "concurrent work and a moved input",
      facts: [
        { fact: "report", exists: true },
        { fact: "delivery", state: "local" },
        { fact: "overlap", state: "open" },
        { fact: "changed_input", state: "changed" },
      ],
      expect: {
        headline: "coordination",
        agent_action: 1,
        coordination: 2,
        human_decision: 0,
        covered: 0,
      },
    },
    {
      name: "owner has not answered",
      facts: [
        { fact: "report", exists: true },
        { fact: "delivery", state: "shared" },
        { fact: "owner_call", state: "pending" },
      ],
      expect: {
        headline: "human_decision",
        agent_action: 0,
        coordination: 0,
        human_decision: 1,
        covered: 0,
      },
    },
    {
      name: "owner declined",
      facts: [
        { fact: "report", exists: true },
        { fact: "delivery", state: "shared" },
        { fact: "owner_call", state: "declined" },
      ],
      expect: {
        headline: "agent_action",
        agent_action: 1,
        coordination: 0,
        human_decision: 0,
        covered: 0,
      },
    },
  ];

  it.each(CASES)("classifies $name", ({ facts, expect: want }) => {
    const next = handoffNextSteps(facts);
    expect({
      headline: next.headline,
      agent_action: next.agent_action.length,
      coordination: next.coordination.length,
      human_decision: next.human_decision.length,
      covered: next.covered.length,
    }).toEqual(want);
  });

  it("keeps the sixteen rule ids of the decision model and every value meets one rule", () => {
    expect(HANDOFF_RULES.map((rule) => rule.id)).toEqual([
      "no-report",
      "has-report",
      "not-observed",
      "not-shared",
      "delivered",
      "failed-no-home",
      "failed-left-to-dependent",
      "unverified-nobody",
      "unverified-task",
      "unverified-person",
      "overlap-open",
      "overlap-resolved",
      "call-pending",
      "call-declined",
      "call-settled",
      "input-moved",
    ]);
    const facts: ReadonlyArray<HandoffFact> = [
      { fact: "report", exists: true },
      { fact: "report", exists: false },
      ...(["absent", "none", "local", "shared", "landed"] as const).map((state) => ({
        fact: "delivery" as const,
        state,
      })),
      { fact: "failed_item", home: "none" },
      { fact: "failed_item", home: "dependent_task" },
      { fact: "unverified_item", answered_by: "nobody" },
      { fact: "unverified_item", answered_by: "task" },
      { fact: "unverified_item", answered_by: "person" },
      { fact: "overlap", state: "open" },
      { fact: "overlap", state: "resolved" },
      ...(["pending", "accepted", "declined", "withdrawn", "expired"] as const).map((state) => ({
        fact: "owner_call" as const,
        state,
      })),
      { fact: "changed_input", state: "changed" },
      { fact: "changed_input", state: "gone" },
    ];
    expect(new Set(facts.map((fact) => handoffRule(fact).id)).size).toBe(HANDOFF_RULES.length);
  });

  it("gives what someone answers for no step and never reads an item's text", () => {
    const covered = handoffNextSteps([
      { fact: "unverified_item", answered_by: "task", label: "Ask Ana to decide this" },
    ]);
    expect(covered.steps).toEqual([
      {
        rule: "unverified-task",
        class: "covered",
        actor: null,
        next: null,
        label: "Ask Ana to decide this",
        who: null,
      },
    ]);
    expect(covered.headline).toBeNull();
  });

  it("says a delivery was not observed without claiming the agent failed to deliver", () => {
    const [step] = handoffNextSteps([{ fact: "delivery", state: "absent" }]).agent_action;
    expect(step?.rule).toBe("not-observed");
    expect(step?.next).toBe("Report the delivery; an older app may not send it");
  });
});

describe("a handoff's facts", () => {
  const live: PeerHandoffSignals = {
    evaluated: true,
    at: "2026-10-31T10:00:00Z",
    signals: ["failed", "unowned", "owner-call"],
    handoff: {
      email: "ana@acme.test",
      session: "s1",
      environment: "e1",
      at: "2026-10-31T09:00:00Z",
      mode: "ask",
      version: 1,
      signals: ["failed", "unowned", "owner-call"],
      accepted: false,
    },
    reports: [{ author: "a", role: "author", number: 2, result: "mixed", at: "t" }],
    items: [
      { ...base("left"), kind: "fail", failed: true, task: "3.1" },
      { ...base("typecheck"), kind: "unverified", failed: false },
      { ...base("spec"), kind: "unverified", failed: false, owner: "ana@acme.test" },
      { ...base("saw it fail"), kind: "pass", failed: true },
    ],
    overlaps: [{ id: "o", sessions: ["s1"], files: ["a.ts"] }],
    ownerCalls: [
      { id: "c1", owner: "eva@acme.test", state: "pending", paths: ["b.ts"], task: "t" },
      { id: "c2", owner: "eva@acme.test", state: "declined", paths: ["c.ts"], task: "t" },
    ],
    changedInputs: [{ scope: "task:t", readVersion: 1, currentVersion: null }],
  };
  function base(text: string) {
    return { text, author: "a", role: "author", number: 2, index: 0 };
  }

  it("tells three owners apart from the Hub's current facts", () => {
    const next = handoffNextSteps(liveHandoffFacts(live));
    expect(next.headline).toBe("human_decision");
    expect(next.agent_action.map((step) => step.rule)).toEqual([
      "not-observed",
      "unverified-nobody",
      "failed-no-home",
      "call-declined",
    ]);
    expect(next.coordination.map((step) => step.rule)).toEqual([
      "failed-left-to-dependent",
      "overlap-open",
      "input-moved",
    ]);
    expect(next.human_decision.map((step) => [step.rule, step.who])).toEqual([
      ["unverified-person", "ana@acme.test"],
      ["call-pending", "eva@acme.test"],
    ]);
  });

  it("has none when no agent handoff was evaluated", () => {
    expect(liveHandoffFacts({ evaluated: false, at: "t", signals: [] })).toEqual([]);
  });

  it("falls back to what the package recorded, keeping a call with a person", () => {
    const next = handoffNextSteps(
      packageHandoffFacts({
        ...p,
        source: "agent",
        policy: { mode: "ask", version: 1, signals: ["failed", "owner-call"], accepted: false },
        report: {
          number: 1,
          result: "mixed",
          author: "a",
          role: "author",
          at: "t",
          passed: 0,
          failed: 1,
          unverified: 1,
          unowned: ["typecheck"],
        },
        overlaps: [],
        inputs: [],
      }),
    );
    expect(next.agent_action.map((step) => step.label)).toEqual([null, null, "typecheck"]);
    expect(next.human_decision.map((step) => step.rule)).toEqual(["call-pending"]);
  });

  it("claims nothing about a person's handoff but its overlaps and inputs", () => {
    const facts = packageHandoffFacts({
      ...p,
      source: "person",
      policy: undefined,
      overlaps: [{ state: "open", files: ["a"], partner: null, at: "t" }],
      inputs: [],
    });
    expect(facts.map((fact) => fact.fact)).toEqual(["overlap"]);
  });

  describe("from the status", () => {
    const place = { workspace: "w", project: "p", task: "t" };
    const summary = {
      project: "p",
      task: "t",
      author: "a@acme.test",
      number: 1,
      composedAt: "2026-10-31T09:00:00Z",
      contextVersion: null,
      pullRequests: 0,
      source: "agent" as const,
      workspace: "w",
      delivery: {
        state: "shared" as const,
        evidence: {},
        observedAt: "t",
        environment: "e",
        vcs: "git" as const,
      },
    };
    const tests = (over: object) => ({
      workspace: "w",
      project: "p",
      task: "t",
      author: "a@acme.test",
      number: 1,
      result: "mixed" as const,
      role: "author",
      at: "t",
      passed: 0,
      failed: 0,
      unverified: 0,
      unowned: 0,
      ...over,
    });
    const status = (
      signals: ReadonlyArray<string>,
      summaries: ReadonlyArray<ReturnType<typeof tests>>,
    ) =>
      ({
        handoff: {
          target: "none",
          projectTargets: {},
          deliveries: [],
          summaries: [
            {
              ...summary,
              policy: { mode: "ask", version: 1, signals, accepted: false },
            },
          ],
        },
        testReports: { summaries },
        coordination: { enabled: true, overlaps: [] },
      }) as unknown as PeerHubStatus;

    it("reads report counts, which move, over the signals frozen at the handoff", () => {
      const read = statusHandoffFacts(
        status(["unowned"], [tests({ asks: ["ana@acme.test"], unverified: 1 })]),
        place,
      );
      const next = handoffNextSteps(read?.facts ?? []);
      expect(next.agent_action).toEqual([]);
      expect(next.human_decision.map((step) => step.who)).toEqual(["ana@acme.test"]);
      expect(read?.at).toBe("2026-10-31T09:00:00Z");
    });

    it("tells a failure with a home from one without, once this computer read the report", () => {
      const read = statusHandoffFacts(
        status(["failed"], [tests({ failed: 2, failedLeft: 1 })]),
        place,
      );
      const next = handoffNextSteps(read?.facts ?? []);
      expect(next.agent_action.map((step) => step.rule)).toEqual(["failed-no-home"]);
      expect(next.coordination.map((step) => step.rule)).toEqual(["failed-left-to-dependent"]);
    });

    it("lets a review session's failure stand over an author's later pass", () => {
      const read = statusHandoffFacts(
        status(
          ["failed"],
          [
            tests({ author: "r@acme.test", role: "review", failed: 1, at: "2026-10-31T08:00:00Z" }),
            tests({ result: "pass", at: "2026-10-31T09:00:00Z" }),
          ],
        ),
        place,
      );
      expect(handoffNextSteps(read?.facts ?? []).agent_action).toHaveLength(1);
    });

    it("drops an overlap the status no longer holds open", () => {
      const read = statusHandoffFacts(status(["open-overlap"], [tests({})]), place);
      expect(handoffNextSteps(read?.facts ?? []).coordination).toEqual([]);
    });

    it("has nothing to say of a person's handoff", () => {
      const person = status([], []);
      expect(
        statusHandoffFacts(
          {
            ...person,
            handoff: {
              target: "none",
              projectTargets: {},
              deliveries: [],
              summaries: [{ ...summary, source: "person" }],
            },
          },
          place,
        ),
      ).toBeUndefined();
    });
  });
});

describe("decisionLine with next steps", () => {
  const pkg = {
    task: "t",
    key: "1.1",
    policy: {
      mode: "ask" as const,
      version: 1,
      signals: ["failed", "unowned"] as const,
      accepted: false,
    },
  };
  const steps = (...facts: ReadonlyArray<HandoffFact>) => ({ steps: handoffNextSteps(facts) });
  const failed: HandoffFact = { fact: "failed_item", home: "none" };

  it("reads With the agent only while its run can act, and keeps Mark done", () => {
    const live = decisionLine(pkg, null, { ...steps(failed), runLive: true });
    expect(live.text).toBe("With the agent");
    expect(live.actions).toEqual(["done", "reopen"]);
    const ended = decisionLine(pkg, null, { ...steps(failed), runLive: false });
    expect(ended.text).toBe("Accept 1.1? 2 signals: failed, unowned");
  });

  it("leads with the first class that has an entry", () => {
    const line = (...facts: ReadonlyArray<HandoffFact>) =>
      decisionLine(pkg, null, { ...steps(...facts), runLive: true }).text;
    expect(line(failed, { fact: "overlap", state: "open" })).toBe("Coordination needed");
    expect(
      line(
        failed,
        { fact: "overlap", state: "open" },
        { fact: "unverified_item", answered_by: "person" },
      ),
    ).toBe("Human decision needed");
  });

  it("no longer counts a signal cleared since the handoff, and says it was raised then", () => {
    const line = decisionLine(pkg, null, { signals: ["failed"] });
    expect(line.text).toBe("Accept 1.1? 1 signal: failed");
    expect(line.raisedAtHandoff).toEqual(["unowned"]);
  });

  it("lets an acceptance stand over any open step", () => {
    const line = decisionLine(pkg, { by: "a", via: "person" }, { ...steps(failed), runLive: true });
    expect(line.kind).toBe("accepted");
  });
});

describe("verifiedChip and seen failures", () => {
  it("counts a pass Peer saw fail as failed, never as seen run by Peer", () => {
    const chip = verifiedChip({
      items: [{ kind: "pass", text: "x", seen: { failed: true, at: "t" } }],
    });
    expect(chip.counts?.failed).toBe(1);
    expect(chip.counts?.seen).toBe(0);
    expect(chip.attention).toBe(true);
  });
});
