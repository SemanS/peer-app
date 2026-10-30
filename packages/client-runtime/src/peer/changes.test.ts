import { describe, expect, it } from "vite-plus/test";
import type { ChangeRow, JujutsuState, LandedChange, ProjectChanges } from "@t3tools/contracts";
import {
  awaitsReview,
  changeGraph,
  changeIdParts,
  changeInspector,
  changeKeyAndTitle,
  changeRowModel,
  changeSourceLine,
  changeStat,
  changesPage,
  isMine,
  markReviewedLabel,
  needAttentionCount,
  olderBaseOf,
  rebaseTargetOf,
  reviewAgainLine,
  reviewVersions,
  scopeRows,
  taskStack,
  waitsForYou,
} from "./changes.ts";

const NOW = Date.parse("2026-10-18T15:00:00Z");
const at = (hhmm: string) => `2026-10-18T${hhmm}:00Z`;
const id = (head: string) => head.padEnd(32, "k");
const commit = (head: string) => head.padEnd(40, "0");

interface Seed {
  readonly head: string;
  readonly parent?: string;
  readonly subject: string;
  readonly email: string;
  readonly agent: string;
  readonly task: string;
  readonly since: string;
  readonly last: string;
  readonly working?: boolean;
  readonly paths?: ReadonlyArray<string>;
  readonly versions?: number;
  readonly sessions?: ChangeRow["sessions"];
  readonly extra?: Partial<ChangeRow>;
}

const row = (seed: Seed): ChangeRow => {
  const count = seed.versions ?? 1;
  return {
    project: "ordering",
    changeId: id(seed.head),
    commitId: commit(`${seed.head}${count}`),
    parents: seed.parent === undefined ? [] : [id(seed.parent)],
    subject: seed.subject,
    paths: seed.paths ?? ["a.js"],
    bookmarks: [`feature/${seed.task}-3f2a1b2c`],
    conflict: false,
    empty: false,
    divergent: false,
    working: seed.working ?? true,
    author: { email: seed.email, agent: seed.agent },
    versions: Array.from({ length: count }, (_, i) => ({
      commit: commit(`${seed.head}${i + 1}`),
      at: i === 0 ? at(seed.since) : at(seed.last),
      kind: i === 0 ? "edit" : "edit",
    })),
    sessions: seed.sessions ?? [
      {
        email: seed.email,
        agent: seed.agent,
        environment: "mac",
        task: seed.task,
        working: seed.working ?? true,
      },
    ],
    lastReportAt: at(seed.last),
    task: seed.task,
    ...seed.extra,
  };
};

// The canvas's scenario: Bob's ORD-12 on Ana's ORD-11; Eva's ORD-14 and Slavo's ORD-15 on main.
const ORD12 = row({
  head: "mspqrmyv",
  parent: "lrorvllt",
  subject: "ORD-12: loyalty points",
  email: "bob@acme.test",
  agent: "codex",
  task: "ORD-12",
  since: "14:40",
  last: "14:59",
  versions: 6,
  paths: ["loyalty.js"],
});
const ORD11 = row({
  head: "lrorvllt",
  subject: "ORD-11: orderTotal returns integer cents",
  email: "ana@acme.test",
  agent: "claude-code",
  task: "ORD-11",
  since: "14:31",
  last: "14:57",
  working: false,
  versions: 7,
  paths: ["order.js"],
  sessions: [
    {
      email: "bob@acme.test",
      agent: "codex",
      environment: "mac",
      task: "ORD-12",
      working: true,
    },
  ],
});
const ORD14 = row({
  head: "smptwtuk",
  subject: "ORD-14: totals include VAT",
  email: "eva@acme.test",
  agent: "claude-code",
  task: "ORD-14",
  since: "14:36",
  last: "14:59",
  versions: 9,
  paths: ["order.js"],
});
const ORD15 = row({
  head: "qpvuntsm",
  subject: "ORD-15: refund reasons",
  email: "slavo@acme.test",
  agent: "claude-code",
  task: "ORD-15",
  since: "14:22",
  last: "14:59",
  versions: 12,
  paths: ["refunds/reasons.js", "refunds/reasons.test.js", "README.md"],
});
const MAIN: LandedChange = {
  changeId: id("zsmtoopz"),
  commitId: commit("zs"),
  subject: "ORD-9: refund fee field",
  bookmark: "main@origin",
};
const ALL = [ORD11, ORD14, ORD12, ORD15];

describe("changeGraph", () => {
  const graph = changeGraph({ changes: ALL, landed: MAIN });
  const keys = graph.rows.map((r) => r.id.slice(0, 8));

  it("lists newest started stacks first and ends at trunk's newest landed change", () => {
    expect(keys).toEqual(["mspqrmyv", "lrorvllt", "smptwtuk", "qpvuntsm", "zsmtoopz"]);
    expect(graph.rows.at(-1)?.kind).toBe("landed");
  });

  it("puts Bob's change on Ana's in one lane", () => {
    const [bob, ana] = graph.rows;
    expect(bob?.lane).toBe(0);
    expect(ana?.lane).toBe(0);
    expect(bob?.continues).toBe(true);
    expect(ana?.fromAbove).toBe(true);
  });

  it("puts Eva's and Slavo's changes in a second lane that joins main", () => {
    const [, , eva, slavo, main] = graph.rows;
    expect(eva?.lane).toBe(1);
    expect(slavo?.lane).toBe(1);
    expect(eva?.through).toEqual([0]);
    expect(eva?.continues).toBe(false);
    expect(eva?.joins).toEqual([{ from: 1, to: 0 }]);
    expect(slavo?.joins).toEqual([{ from: 1, to: 0 }]);
    expect(main?.lane).toBe(0);
    expect(graph.lanes).toBe(2);
  });

  it("draws jj's shapes: a dot when an agent works, a ring when nobody does, a diamond, a cross", () => {
    expect(graph.rows.map((r) => r.shape)).toEqual(["dot", "ring", "dot", "dot", "diamond"]);
    const conflicted = changeGraph({
      changes: [{ ...ORD14, conflict: true }],
      landed: MAIN,
    });
    expect(conflicted.rows[0]?.shape).toBe("cross");
  });

  it("is stable whatever order the Hub lists the rows in", () => {
    const shuffled = changeGraph({ changes: [ORD15, ORD12, ORD14, ORD11], landed: MAIN });
    expect(shuffled.rows.map((r) => r.id)).toEqual(graph.rows.map((r) => r.id));
  });

  it("treats a parent that is not in flight as trunk, and survives a cycle", () => {
    const orphan = changeGraph({ changes: [{ ...ORD14, parents: [id("unknown")] }], landed: MAIN });
    expect(orphan.rows.map((r) => r.kind)).toEqual(["change", "landed"]);
    const a = { ...ORD11, parents: [ORD12.changeId] };
    const cycle = changeGraph({ changes: [a, ORD12] });
    expect(cycle.rows).toHaveLength(2);
  });

  it("keeps a merge's second parent in a lane of its own", () => {
    const left = row({
      head: "aaaa",
      subject: "A",
      email: "a@x",
      agent: "codex",
      task: "A-1",
      since: "14:00",
      last: "14:01",
    });
    const right = row({
      head: "bbbb",
      subject: "B",
      email: "b@x",
      agent: "codex",
      task: "B-1",
      since: "14:00",
      last: "14:01",
    });
    const merge = {
      ...row({
        head: "cccc",
        subject: "C",
        email: "c@x",
        agent: "codex",
        task: "C-1",
        since: "14:10",
        last: "14:11",
      }),
      parents: [left.changeId, right.changeId],
    };
    const g = changeGraph({ changes: [left, right, merge] });
    expect(g.rows[0]?.id).toBe(merge.changeId);
    expect(g.rows[0]?.joins).toEqual([{ from: 0, to: 1 }]);
    expect(g.lanes).toBe(2);
  });

  it("is empty without changes", () => {
    expect(changeGraph({ changes: [] })).toEqual({ rows: [], lanes: 0 });
  });
});

describe("rows and inspector", () => {
  const context = {
    me: "slavo@acme.test",
    now: NOW,
    marks: [],
    awaitingReview: new Set([ORD11.changeId]),
  };

  it("emphasizes the shortest unique prefix, two letters at least", () => {
    expect(
      changeIdParts(
        ORD12.changeId,
        ALL.map((r) => r.changeId),
      ),
    ).toEqual({ pre: "ms", rest: "pqrmyv" });
    const near = [id("mspqrmyv"), id("msxxxxxx")];
    expect(changeIdParts(near[0] as string, near).pre).toBe("msp");
  });

  it("reads Bob's row as the canvas does", () => {
    const model = changeRowModel(
      { ...ORD12, source: "shared", sourceAt: at("14:59") },
      ALL,
      context,
    );
    expect(model.key).toBe("ORD-12");
    expect(model.title).toBe("Loyalty points");
    expect(model.who).toBe("Bob · Codex");
    expect(model.source).toBe("shared 1 min ago");
    expect(model.stat).toBe("1 file");
    expect(model.badges.map((b) => b.label)).toEqual(["Working", "Builds on ORD-11"]);
    expect(model.badges[1]?.link).toBe(ORD11.changeId);
  });

  it("says when a change still sits on an older version of what it builds on", () => {
    const label = (parentCommits: ReadonlyArray<string>) =>
      changeRowModel({ ...ORD12, parentCommits }, ALL, context).badges.at(-1)?.label;
    expect(label([ORD11.commitId])).toBe("Builds on ORD-11");
    expect(label([commit("lrorvllt6")])).toBe("Builds on ORD-11 at v6 of 7");
    expect(label(["9".repeat(40)])).toBe("Builds on ORD-11 at an older version");
    expect(olderBaseOf(ORD12, ORD11)).toBeUndefined();
    expect(olderBaseOf({ ...ORD12, parentCommits: [commit("lrorvllt6")] }, ORD11)).toEqual({
      changeId: ORD11.changeId,
      key: "ORD-11",
      version: 6,
      newest: 7,
    });
    const view = changeInspector({ ...ORD12, parentCommits: [commit("lrorvllt6")] }, ALL, context);
    expect(view.olderBases.map((base) => base.version)).toEqual([6]);
    expect(changeInspector(ORD12, ALL, context).olderBases).toEqual([]);
    expect(rebaseTargetOf(ORD12, ALL)).toBe("ORD-11");
    expect(rebaseTargetOf(ORD11, ALL)).toBeUndefined();
  });

  it("says the person looking, live and pushed sources, and lines", () => {
    const mine = changeRowModel(
      { ...ORD15, source: "live", lines: { added: 41, removed: 2 } },
      ALL,
      context,
    );
    expect(mine.who).toBe("Slavo (you) · Claude Code");
    expect(mine.source).toBe("live on this computer");
    expect(mine.stat).toBe("3 files +41 −2");
    expect(changeSourceLine({ ...ORD11, source: "pushed" }, NOW)).toBe(
      "pushed as feature/ORD-11-3f2a1b2c",
    );
    expect(changeSourceLine(ORD11, NOW)).toBe("reported 3 min ago");
    expect(changeStat({ ...ORD11, paths: Array.from({ length: 50 }, (_, i) => `f${i}`) })).toBe(
      "50+ files",
    );
    expect(changeStat({ ...ORD11, paths: [] })).toBe("");
  });

  it("derives the task key from the subject when no session names one", () => {
    const bare = { ...ORD12, task: undefined, sessions: [] };
    expect(changeKeyAndTitle(bare)).toEqual({ key: "ORD-12", title: "Loyalty points" });
    expect(changeKeyAndTitle({ ...bare, subject: "tidy imports" })).toEqual({
      key: undefined,
      title: "tidy imports",
    });
  });

  it("builds the inspector for ORD-12", () => {
    const view = changeInspector(ORD12, ALL, context);
    expect(view.state).toEqual({ label: "Working", tone: "info" });
    expect(view.buildsOn).toEqual(["ORD-11"]);
    expect(view.versions.count).toBe(6);
    expect(view.versions.since).toBe(at("14:40"));
    expect(view.versions.lastAgo).toBe("1 min ago");
    expect(view.rewriters).toEqual({ person: "Bob", agent: "Codex", mine: false });
    expect(view.files).toEqual(["loyalty.js"]);
    expect(changeInspector(ORD11, ALL, context).buildsOnIt).toEqual(["ORD-12"]);
    expect(changeInspector(ORD11, ALL, context).state.label).toBe("Ready for your review");
  });

  it("names the two versions of a divergent change", () => {
    const divergent = { ...ORD12, divergent: true };
    expect(changeInspector(divergent, ALL, context).versionIds).toEqual([
      "mspqrmy/0".replace("mspqrmy", "mspqrmyv"),
      "mspqrmyv/1",
    ]);
    expect(changeRowModel(divergent, ALL, context).badges.map((b) => b.id)).toContain(
      "twoVersions",
    );
  });
});

describe("Mine", () => {
  const marks = [
    {
      changeId: ORD11.changeId,
      commit: ORD11.versions[4]?.commit ?? "",
      version: 5,
      at: at("14:50"),
    },
  ];
  const input = { me: "slavo@acme.test", marks, awaitingReview: undefined };

  it("keeps what the person runs, owns or reviews bright and dims the rest, still listed", () => {
    expect(isMine(ORD15, input)).toBe(true);
    expect(isMine(ORD11, input)).toBe(true);
    expect(isMine(ORD12, input)).toBe(false);
    expect(isMine(ORD14, input)).toBe(false);
    const graph = changeGraph({ changes: ALL, landed: MAIN });
    const rows = scopeRows(graph, "mine", input);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => [r.row.id.slice(0, 8), r.dimmed])).toEqual([
      ["mspqrmyv", true],
      ["lrorvllt", false],
      ["smptwtuk", true],
      ["qpvuntsm", false],
      ["zsmtoopz", false],
    ]);
    expect(scopeRows(graph, "everyone", input).some((r) => r.dimmed)).toBe(false);
  });

  it("counts a session of the person's that builds on a change as running it", () => {
    const withMe = {
      ...ORD11,
      author: { email: "ana@acme.test", agent: "claude-code" },
      sessions: [
        { email: "slavo@acme.test", agent: "claude-code", environment: "mac", working: true },
      ],
    };
    expect(isMine(withMe, { me: "SLAVO@acme.test" })).toBe(true);
  });
});

describe("review and what waits for the person", () => {
  const withVersions = {
    ...ORD11,
    versions: ORD11.versions.map((v, i) => ({
      ...v,
      kind: i === 3 ? "description" : i === 5 ? "rebase" : "edit",
    })),
  };
  const mark = {
    changeId: ORD11.changeId,
    commit: withVersions.versions[4]?.commit ?? "",
    version: 5,
    at: at("14:50"),
  };

  it("lists v1 to v7 with the rebase, the mark and the newest", () => {
    const versions = reviewVersions(withVersions, mark);
    expect(versions.map((v) => v.label)).toEqual([
      "first edit",
      "edit",
      "edit",
      "description",
      "edit",
      "rebased onto main",
      "edit · now",
    ]);
    expect(versions.filter((v) => v.marked).map((v) => v.n)).toEqual([5]);
    expect(versions.at(-1)?.now).toBe(true);
    expect(reviewVersions(withVersions, mark, "ORD-11")[5]?.label).toBe("rebased onto ORD-11");
  });

  it("reminds the reviewer of versions since the mark, from the commit, not the number", () => {
    expect(reviewAgainLine(withVersions, [mark])).toBe(
      "2 versions since you marked v5 reviewed · order.js",
    );
    expect(awaitsReview(withVersions, { me: "slavo@acme.test", marks: [mark] })).toBe(true);
    const current = { ...mark, commit: withVersions.versions[6]?.commit ?? "", version: 7 };
    expect(reviewAgainLine(withVersions, [current])).toBeNull();
    expect(markReviewedLabel(withVersions, current)).toBeNull();
    expect(markReviewedLabel(withVersions, mark)).toEqual({
      label: "Mark v7 reviewed",
      version: 7,
      commit: withVersions.versions[6]?.commit,
    });
    expect(markReviewedLabel(withVersions, undefined)?.label).toBe("Mark v7 reviewed");
  });

  it("lists only what waits for the person", () => {
    const waits = waitsForYou(ALL, { me: "slavo@acme.test", marks: [mark] });
    expect(waits.map((w) => [w.kind, w.text])).toEqual([["review", "Review ORD-11 again"]]);
    expect(waits[0]?.moved?.versions).toBe(2);
    const conflict = waitsForYou([{ ...ORD15, conflict: true, divergent: true }], {
      me: "slavo@acme.test",
    });
    expect(conflict.map((w) => w.kind)).toEqual(["conflict", "twoVersions"]);
    expect(waitsForYou([{ ...ORD14, conflict: true }], { me: "slavo@acme.test" })).toEqual([]);
    expect(
      waitsForYou([ORD12], { me: "slavo@acme.test", awaitingReview: new Set([ORD12.changeId]) })[0]
        ?.text,
    ).toBe("Review ORD-12");
  });

  it("counts the changes that hold a conflict or two versions", () => {
    expect(
      needAttentionCount([ORD11, { ...ORD12, conflict: true }, { ...ORD14, divergent: true }]),
    ).toBe(2);
  });
});

describe("a task's stack", () => {
  it("lists the task's change, the teammate's under it read-only, and main", () => {
    const stack = taskStack({ changes: ALL, landed: MAIN }, "ORD-12", {
      me: "bob@acme.test",
      now: NOW,
    });
    expect(stack.entries.map((e) => e.change.changeId.slice(0, 8))).toEqual([
      "mspqrmyv",
      "lrorvllt",
    ]);
    expect(stack.entries.map((e) => [e.yours, e.readOnly])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(stack.entries[1]?.versions).toBe(7);
    expect(stack.entries[1]?.movedAgo).toBe("3 min ago");
    expect(stack.entries.map((e) => e.satOnOlder)).toEqual([undefined, undefined]);
    expect(stack.landed).toBe(MAIN);
    const behind = taskStack(
      { changes: [{ ...ORD12, parentCommits: [commit("lrorvllt6")] }, ORD11], landed: MAIN },
      "ORD-12",
      { me: "bob@acme.test", now: NOW },
    );
    expect(behind.entries[1]?.satOnOlder).toEqual({
      changeId: ORD11.changeId,
      key: "ORD-11",
      version: 6,
      newest: 7,
    });
    expect(taskStack({ changes: ALL, landed: MAIN }, "ORD-99", { me: null, now: NOW })).toEqual({
      entries: [],
      landed: undefined,
    });
  });
});

describe("the page's honest states", () => {
  const base = { project: "ordering", now: NOW, me: "slavo@acme.test" };
  const jj = (over: Partial<JujutsuState>): JujutsuState => ({
    connection: "connected",
    agentWorkspaces: 3,
    protection: true,
    version: "0.46.0",
    ...over,
  });
  const view = (over: Partial<ProjectChanges> = {}): ProjectChanges => ({
    workspace: "acme",
    project: "ordering",
    changes: ALL,
    landed: MAIN,
    marks: [],
    problems: [],
    readAt: at("14:59"),
    ...over,
  });

  it("names the cause and the fix when jj is missing, too old or not colocated", () => {
    const missing = changesPage({
      ...base,
      jujutsu: jj({ connection: "notAvailable", problem: "missing", version: undefined }),
    });
    expect(missing).toMatchObject({
      kind: "jj",
      note: { kind: "missing", word: "Not available", fix: "brew install jj" },
    });
    const old = changesPage({
      ...base,
      jujutsu: jj({ connection: "notAvailable", problem: "tooOld", version: "0.38.0" }),
    });
    expect(old).toMatchObject({
      kind: "jj",
      note: {
        title: "jj 0.38.0 is older than Peer needs",
        word: "Problem",
        fix: "brew upgrade jj",
      },
    });
    const plain = changesPage({
      ...base,
      jujutsu: jj({ connection: "problem", problem: "notColocated", notColocated: ["ordering"] }),
    });
    expect(plain).toMatchObject({ kind: "jj", note: { fix: "jj git colocation enable" } });
    const other = changesPage({
      ...base,
      jujutsu: jj({ connection: "problem", problem: "notColocated", notColocated: ["other"] }),
      view: view(),
    });
    expect(other.kind).toBe("ready");
  });

  it("says an older Hub, loading, a jj failure and the empty project", () => {
    expect(changesPage({ ...base, hubSupport: "unsupported" }).kind).toBe("hubOlder");
    const loading = changesPage({ ...base, jujutsu: jj({}) });
    expect(loading).toMatchObject({ kind: "loading", title: "Reading the repository" });
    expect((loading as { body: string }).body).toContain("3 workspaces");
    expect(
      changesPage({
        ...base,
        view: view({
          changes: [],
          problems: [{ workspace: "ORD-12-3f2a1b2c", message: "The working copy is stale" }],
        }),
      }),
    ).toMatchObject({
      kind: "failed",
      title: "jj failed in ORD-12-3f2a1b2c",
      footnote: "Peer retries at the agent's next tool step.",
    });
    expect(changesPage({ ...base, view: view({ changes: [], landed: MAIN }) })).toMatchObject({
      kind: "empty",
      title: "No changes in flight",
      action: "Start an agent…",
    });
  });

  it("shows the graph with Git teammates by branch and the two versions", () => {
    const page = changesPage({
      ...base,
      view: view({ changes: [ORD11, { ...ORD12, divergent: true }, ORD14, ORD15] }),
      gitTeammates: [
        {
          email: "ana@acme.test",
          agent: "claude-code",
          task: "ORD-11",
          branch: "feature/ORD-11-cents",
        },
      ],
    });
    if (page.kind !== "ready") throw new Error(`expected the graph, got ${page.kind}`);
    expect(page.graph.rows).toHaveLength(5);
    expect(page.summary).toBe("4 changes in flight · 4 people · 1 needs you · checked 1 min ago");
    expect(page.byBranch[0]).toMatchObject({
      who: "Ana · Claude Code",
      key: "ORD-11",
      branch: "feature/ORD-11-cents",
    });
    expect(page.twoVersions).toEqual([
      {
        changeId: ORD12.changeId,
        title: "ORD-12 has two versions at once",
        versionIds: ["mspqrmyv/0", "mspqrmyv/1"],
      },
    ]);
  });

  it("keeps a teammate on Git by branch when nothing else is in flight", () => {
    const page = changesPage({
      ...base,
      view: view({ changes: [] }),
      gitTeammates: [{ email: "ana@acme.test", branch: "feature/ORD-11-cents" }],
    });
    expect(page).toMatchObject({ kind: "empty" });
    if (page.kind !== "empty") throw new Error("expected the empty state");
    expect(page.byBranch).toHaveLength(1);
  });
});
