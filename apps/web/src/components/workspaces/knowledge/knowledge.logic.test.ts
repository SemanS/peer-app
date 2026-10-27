import { describe, expect, it } from "vite-plus/test";

import {
  bodyBeyondSummary,
  candidateGroups,
  decidedChallenges,
  decisionStats,
  driftSummaries,
  driftSummary,
  driftedPaths,
  entryHealth,
  entryTitle,
  entryValidities,
  kindLabel,
  kindPlural,
  knowledgeArea,
  knowledgeAreas,
  knowledgeHealth,
  kontextCaptureCommand,
  plainSummary,
  premiseNotices,
  provenanceLine,
  relationOffer,
  sinceLine,
  type EntryValidity,
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

describe("knowledge for people", () => {
  it("reads a Markdown excerpt as plain prose", () => {
    expect(
      plainSummary(
        "## Overview `strata-server` (binary `strata`) is the crate root. It serves **HTTP** APIs.",
      ),
    ).toBe("strata-server (binary strata) is the crate root. It serves HTTP APIs.");
    expect(
      plainSummary("## Overview\n\n- Uses [TiKV](https://tikv.org) for _state_.\n- Runs `jobs`."),
    ).toBe("Uses TiKV for state. Runs jobs.");
    const long = plainSummary(`${"First part is the gist".padEnd(150, " a")}. ${"b ".repeat(80)}`);
    expect(long.endsWith(".")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(220);
    expect(plainSummary("word ".repeat(80), 40).endsWith("…")).toBe(true);
  });

  it("names slug titles in words and leaves written titles alone", () => {
    expect(entryTitle("server-architecture.md")).toBe("Server architecture");
    expect(entryTitle("Prices are integer cents")).toBe("Prices are integer cents");
  });

  it("places an entry in the part of the project it applies to", () => {
    expect(knowledgeArea(["apps/server/**"])).toBe("apps/server");
    expect(knowledgeArea(["./apps/cli/src/main.rs", "libs/x"])).toBe("apps/cli");
    expect(knowledgeArea(["deploy/run.sh"])).toBe("deploy");
    expect(knowledgeArea(["Cargo.toml"])).toBe("");
    expect(knowledgeArea(undefined)).toBe("");
    const areas = knowledgeAreas([
      { kind: "decision" },
      { kind: "architecture", paths: ["deploy/**"] },
      { kind: "convention", paths: ["apps/server/a.ts"] },
      { kind: "architecture", paths: ["apps/server/**"] },
    ]);
    expect(areas.map((area) => [area.area, area.entries.length, area.kinds])).toEqual([
      ["apps/server", 2, ["architecture", "convention"]],
      ["deploy", 1, ["architecture"]],
      ["", 1, ["decision"]],
    ]);
  });

  it("names kinds for filters and entries", () => {
    expect([kindPlural("decision"), kindLabel("decision")]).toEqual(["Decisions", "Decision"]);
    expect([kindPlural("architecture"), kindLabel("architecture")]).toEqual([
      "Architecture",
      "Architecture",
    ]);
    expect([kindPlural("glossary"), kindLabel("glossary")]).toEqual(["Glossary", "Glossary"]);
  });

  it("tells changed code from a person's doubt and ignores settled challenges", () => {
    const row = (entry: string, status: string, origin?: string) => ({
      challenge: {
        entry,
        status,
        ...(origin === "drift" ? { drift: {} } : {}),
        sources: [{ origin }],
      },
    });
    const validity = entryValidities([
      row("a", "open", "drift"),
      row("b", "open"),
      row("c", "open", "drift"),
      row("c", "resolving"),
      row("d", "dismissed"),
    ]);
    expect(Object.fromEntries(validity)).toEqual({
      a: "needs-review",
      b: "challenged",
      c: "challenged",
    });
  });
});

describe("knowledge health", () => {
  it("counts verified, unverified and needing review from the entries themselves", () => {
    const validity = new Map<string, EntryValidity>([
      ["c", "needs-review"],
      ["d", "challenged"],
    ]);
    const counts = knowledgeHealth(
      [
        { id: "a", checked: "2026-10-20" },
        { id: "b" },
        { id: "c", checked: "2026-10-01" },
        { id: "d" },
      ],
      (entry) => validity.get(entry) ?? "current",
    );
    expect(counts).toEqual({ verified: 1, stamped: 0, unverified: 1, "needs-review": 2 });
    expect(entryHealth({ checked: "2026-10-20" }, "current")).toBe("verified");
  });

  const at = (
    kind: "read" | "agent" | "bulk" | "verify",
    more: { passed?: boolean | null; commit?: string | null; by?: string | null } = {},
  ) => ({
    at: "2026-10-25T08:00:00Z",
    kind,
    commit: "55e6844".padEnd(40, "0"),
    by: null,
    because: null,
    passed: null,
    ...more,
  });

  it("trusts a person's read or a passed check, and calls an agent's or bulk confirmation a stamp", () => {
    const checked = "2026-10-25";
    expect(entryHealth({ checked, verification: at("read") }, "current")).toBe("verified");
    expect(entryHealth({ verification: at("verify", { passed: true }) }, "current")).toBe(
      "verified",
    );
    expect(entryHealth({ verification: at("verify", { passed: false }) }, "current")).toBe(
      "needs-review",
    );
    expect(entryHealth({ checked, verification: at("agent") }, "current")).toBe("stamped");
    expect(entryHealth({ checked, verification: at("bulk") }, "current")).toBe("stamped");
    // Commits on its paths since the verification's commit outrank any verification.
    expect(
      entryHealth(
        { verification: at("read"), since: { commits: 2, head: "f", paths: [] } },
        "current",
      ),
    ).toBe("needs-review");
    expect(
      entryHealth(
        { verification: at("read"), since: { commits: 0, head: "f", paths: [] } },
        "current",
      ),
    ).toBe("verified");
    expect(entryHealth({ verification: at("read") }, "challenged")).toBe("needs-review");
    expect(entryHealth({}, "current")).toBe("unverified");
    expect(
      knowledgeHealth(
        [
          { id: "a", verification: at("read") },
          { id: "b", verification: at("agent") },
          { id: "c", verification: at("bulk") },
          { id: "d" },
          { id: "e", checked },
        ],
        () => "current",
      ),
    ).toEqual({ verified: 2, stamped: 2, unverified: 1, "needs-review": 0 });
  });

  it("names the proof and its commit, and a date only where an older kontext gave nothing more", () => {
    expect(provenanceLine({ verification: at("verify", { passed: true }) })).toBe(
      "Verified by its test at 55e6844",
    );
    expect(provenanceLine({ verification: at("verify", { passed: false }) })).toBe(
      "Its test failed at 55e6844",
    );
    expect(provenanceLine({ verification: at("read", { by: "Ana" }) })).toBe(
      "Confirmed by Ana at 55e6844",
    );
    expect(provenanceLine({ verification: at("bulk", { by: "Ana" }) })).toBe(
      "Confirmed by Ana at 55e6844 in a bulk confirmation",
    );
    expect(provenanceLine({ verification: at("agent") })).toBe("Stamped by an agent at 55e6844");
    expect(provenanceLine({ verification: at("read", { commit: null }) })).toBe(
      "Confirmed on 2026-10-25",
    );
    expect(provenanceLine({ checked: "2026-10-25" })).toBe("Confirmed on 2026-10-25");
    expect(provenanceLine({})).toBe("Not verified");
    expect(sinceLine({ since: { commits: 3, head: "f", paths: [] } })).toBe(
      "3 commits on its paths since",
    );
    expect(sinceLine({ since: { commits: 1, head: "f", paths: [] } })).toBe(
      "1 commit on its paths since",
    );
    expect(sinceLine({ since: { commits: 0, head: "f", paths: [] } })).toBeNull();
    expect(sinceLine({})).toBeNull();
    expect(premiseNotices({ premises: [{ id: "old-rounding", status: "superseded" }] })).toEqual([
      "Builds on old-rounding, which is superseded: review whether this still holds.",
    ]);
  });

  it("summarises what changed under an entry from its open drift challenge only", () => {
    const drift = { head: "a".repeat(40), commits: ["c".repeat(40)], paths: ["src/x.ts"] };
    const summaries = driftSummaries([
      {
        challenge: { entry: "e", status: "open", drift },
        commits: [{ sha: "c".repeat(40), subject: "Round once" }],
      },
      { challenge: { entry: "f", status: "dismissed", drift } },
      { challenge: { entry: "g", status: "open" } },
    ]);
    expect([...summaries.keys()]).toEqual(["e"]);
    expect(summaries.get("e")?.commits).toEqual([{ sha: "cccccccc", subject: "Round once" }]);
  });

  it("names the changed files behind open drift challenges only", () => {
    const paths = driftedPaths([
      { challenge: { entry: "e", status: "open", drift: { paths: ["b.rs", "a.rs"] } } },
      { challenge: { entry: "e", status: "open", drift: { paths: ["a.rs"] } } },
      { challenge: { entry: "f", status: "dismissed", drift: { paths: ["c.rs"] } } },
      { challenge: { entry: "g", status: "open" } },
    ]);
    expect([...paths]).toEqual([["e", ["a.rs", "b.rs"]]]);
  });

  it("drops the title heading and a first paragraph that repeats the summary", () => {
    expect(
      bodyBeyondSummary(
        "# Use PP-OCRv5\n\nUse our own **PP-OCRv5** adapter.\n\n## Why\n\nThread pools.",
        "Use PP-OCRv5",
        "Use our own PP-OCRv5 adapter.",
      ),
    ).toBe("## Why\n\nThread pools.");
  });
});
