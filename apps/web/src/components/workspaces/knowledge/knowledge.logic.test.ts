import { describe, expect, it } from "vite-plus/test";

import {
  candidateGroups,
  decidedChallenges,
  decisionStats,
  driftSummary,
  kontextCaptureCommand,
  relationOffer,
} from "./knowledge.logic";

describe("kontextCaptureCommand", () => {
  it("titles a candidate by its first sentence and quotes it for the shell", () => {
    expect(
      kontextCaptureCommand({
        text: "Callers map every error to url_not_public. So a new message reaches API clients.",
        finders: 2,
      }),
    ).toBe(
      "kontext capture --kind learning --title 'Callers map every error to url_not_public.' --body 'Callers map every error to url_not_public. So a new message reaches API clients.\n\n2 agents found it on their own, on different work. Proposed in Peer.'",
    );
    expect(kontextCaptureCommand({ text: "worker.rs isn't guarded", finders: 1 })).toContain(
      "--title 'worker.rs isn'\\''t guarded'",
    );
  });
});

describe("decisionStats", () => {
  it("counts candidates kept for Git review as kept without inferring publication", () => {
    expect(
      decisionStats([
        { status: "kept_pending_review", sources: [{ tagged: true }] },
        { status: "kept_pending_review", sources: [{ tagged: false }] },
        { status: "proposed", sources: [{ tagged: true }] },
      ]),
    ).toEqual({ decided: 2, kept: 2, marked: 1, markedKept: 1 });
  });

  it("counts what people kept, and how many of the agents' own marks", () => {
    const mark = { tagged: true };
    const harvest = { tagged: true, origin: "context:task:krk-335@v4" };
    const found = { tagged: false };
    expect(
      decisionStats([
        { status: "promoted", sources: [mark] },
        { status: "dismissed", sources: [mark] },
        { status: "promoted", sources: [found, found] },
        { status: "promoted", sources: [harvest] },
        { status: "proposed", sources: [mark] },
      ]),
    ).toEqual({ decided: 4, kept: 3, marked: 2, markedKept: 1 });
  });
});

describe("the queue's order", () => {
  it("folds candidates nobody found again for 60 days under Older", () => {
    const groups = candidateGroups([
      { id: "fresh", status: "proposed" },
      { id: "old", status: "proposed", stale: true },
      { id: "kept", status: "promoted", stale: true },
    ]);
    expect(groups.current.map((c) => c.id)).toEqual(["fresh"]);
    expect(groups.older.map((c) => c.id)).toEqual(["old"]);
  });
  it("lists decided challenges newest decision first, and none that wait", () => {
    const row = (id: string, status: string, decidedAt?: string) => ({
      id,
      challenge: { status, lastAt: "2026-10-01T00:00:00Z", ...(decidedAt ? { decidedAt } : {}) },
    });
    expect(
      decidedChallenges([
        row("open", "open"),
        row("resolving", "resolving"),
        row("a", "dismissed", "2026-10-02T00:00:00Z"),
        row("b", "resolved", "2026-10-03T00:00:00Z"),
      ]).map((r) => r.id),
    ).toEqual(["b", "a"]);
  });
});

describe("what a relation to a kept entry offers", () => {
  it("offers replacing on a possible conflict, dismissing on the same, nothing on extending", () => {
    expect(relationOffer("conflicts").offer).toBe("supersede");
    expect(relationOffer("same").offer).toBe("dismiss");
    expect(relationOffer("extends").offer).toBeNull();
    expect(relationOffer("related")).toEqual({ label: "Related to", offer: null });
  });
});

describe("driftSummary", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  it("names the first paths and commits, by subject where this checkout has them", () => {
    const paths = Array.from({ length: 7 }, (_, i) => `src/f${i}.ts`);
    expect(
      driftSummary({ head: "f".repeat(40), commits: [a, b], paths }, [
        { sha: a, subject: "Round once" },
      ]),
    ).toEqual({
      head: "ffffffff",
      paths: paths.slice(0, 5),
      morePaths: 2,
      commits: [
        { sha: "aaaaaaaa", subject: "Round once" },
        { sha: "bbbbbbbb", subject: null },
      ],
      moreCommits: 0,
    });
  });
});
