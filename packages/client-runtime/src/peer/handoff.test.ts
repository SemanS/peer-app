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
} from "./handoff.ts";
import type { PeerHandoffDelivery, PeerTestReportItem } from "@t3tools/contracts";
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
