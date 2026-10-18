import type {
  ChangeRow,
  JujutsuState,
  PeerHubStatus,
  ProjectChanges,
  ReviewDiff,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CHANGES_WORDS,
  changesHeading,
  changesProjects,
  phoneChangesModel,
  phoneReviewDiff,
  phoneTaskChanges,
  waitsHeading,
} from "./changes.logic";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const SLAVO = "slavo@acme.test";
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const version = (n: number, kind = "edit") => ({ commit: `c${n}`, at: iso(120 - n), kind });

function change(id: string, extra: Partial<ChangeRow> = {}): ChangeRow {
  return {
    project: "ordering",
    changeId: id,
    commitId: `${id}-commit`,
    parents: [],
    subject: "subject",
    paths: [],
    bookmarks: [],
    conflict: false,
    empty: false,
    divergent: false,
    working: false,
    author: { email: "ana@acme.test", agent: "claude-code" },
    versions: [version(1)],
    sessions: [],
    lastReportAt: iso(5),
    ...extra,
  };
}

/** ORD-11 waits for Slavo's second look; ORD-12 builds on it; ORD-14 is Eva's work in progress. */
const ORD11 = change("lrorvllt", {
  task: "ORD-11",
  subject: "ORD-11: Receipt totals in cents",
  paths: ["order.js", "totals.js"],
  versions: [1, 2, 3, 4, 5, 6, 7].map((n) => version(n)),
});
const ORD12 = change("mspqrmyv", {
  task: "ORD-12",
  subject: "ORD-12: Loyalty points",
  parents: ["lrorvllt"],
  author: { email: "bob@acme.test", agent: "codex" },
  working: true,
});
const ORD14 = change("smkxplqw", {
  task: "ORD-14",
  subject: "ORD-14: Totals include VAT",
  author: { email: "eva@acme.test", agent: "claude-code" },
  working: true,
});

const view = (changes: ReadonlyArray<ChangeRow>, extra: Partial<ProjectChanges> = {}) =>
  ({
    workspace: "acme",
    project: "ordering",
    changes,
    marks: [{ changeId: "lrorvllt", commit: "c5", version: 5, at: iso(60) }],
    problems: [],
    readAt: iso(1),
    ...extra,
  }) satisfies ProjectChanges;

function status(extra: { jujutsu?: JujutsuState; hubSupport?: "supported" | "unsupported" } = {}) {
  return {
    hubUrl: "https://hub.example.test",
    signedIn: true,
    email: SLAVO,
    pendingSignIn: null,
    joinable: [],
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        projects: [
          {
            project: {
              id: "ordering",
              name: "Ordering demo",
              members: [{ email: "eva@acme.test", name: "Eva" }],
            },
            repositories: [{ vcs: "jj" }],
          },
          { project: { id: "other", name: "Other", members: [] }, repositories: [{}] },
        ],
      },
    ],
    changes: {
      hubSupport: extra.hubSupport ?? "supported",
      projects: [{ workspace: "acme", project: "ordering", inFlight: 3, needAttention: 0 }],
    },
    ...(extra.jujutsu === undefined ? {} : { jujutsu: extra.jujutsu }),
  } as unknown as PeerHubStatus;
}

const project = (s: PeerHubStatus) => {
  const [first] = changesProjects(s);
  if (first === undefined) throw new Error("no project");
  return first;
};
const model = (s: PeerHubStatus, v: ProjectChanges | undefined, error: string | null = null) =>
  phoneChangesModel({ status: s, project: project(s), view: v, error, now: NOW });

describe("which projects get a Changes section", () => {
  it("lists the projects the environment counts changes for, and no Git project without them", () => {
    expect(changesProjects(status()).map((p) => p.projectId)).toEqual(["ordering"]);
  });

  it("lists a jj project whose jj cannot read it, so the section can say what to fix", () => {
    const s = status({
      jujutsu: {
        connection: "notAvailable",
        problem: "missing",
        agentWorkspaces: 0,
        protection: true,
      },
    });
    const bare = { ...s, changes: undefined } as unknown as PeerHubStatus;
    expect(changesProjects(bare).map((p) => p.projectId)).toEqual(["ordering"]);
  });

  it("heads a project by its name, with its workspace's in several", () => {
    const s = status();
    expect(changesHeading(s, project(s))).toBe("Ordering demo");
    const two = { ...s, workspaces: [...s.workspaces, ...s.workspaces] } as PeerHubStatus;
    expect(changesHeading(two, project(s))).toBe("Acme · Ordering demo");
  });
});

describe("Slavo on his phone", () => {
  const ready = () => {
    const m = model(status(), view([ORD11, ORD12, ORD14]));
    if (m.kind !== "ready") throw new Error(`expected ready, got ${m.kind}`);
    return m;
  };

  it("lists only 'Review ORD-11 again' under 'Waits for you', with the versions since his mark", () => {
    const { waits } = ready();
    expect(waitsHeading(waits.length)).toBe("Waits for you · 1");
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({
      kind: "review",
      text: "Review ORD-11 again",
      canReview: true,
      diffMode: "since",
    });
    expect(waits[0]?.detail).toMatch(/^2 versions since you marked v5 reviewed · order\.js/);
  });

  it("says a teammate's change in flight by its state, never by a forecast", () => {
    const { rows, inFlightHeading } = ready();
    expect(inFlightHeading).toBe("In flight · 3");
    const eva = rows.find((row) => row.changeId === "smkxplqw");
    expect(eva?.title).toBe("ORD-14 Totals include VAT");
    expect(eva?.line).toBe("Eva · Claude Code · working");
    const bob = rows.find((row) => row.changeId === "mspqrmyv");
    expect(bob?.line).toBe("Bob · Codex · working · builds on ORD-11");
    expect(JSON.stringify(rows)).not.toMatch(/conflicts? with/i);
  });

  it("asks for a whole-change review before any mark, and offers no button for a conflict", () => {
    const first = change("zzzzzzzz", {
      task: "ORD-20",
      subject: "ORD-20: Menu",
      author: { email: SLAVO, agent: "claude-code" },
      conflict: true,
    });
    const m = model(status(), view([ORD11, first], { marks: [] }));
    if (m.kind !== "ready") throw new Error("expected ready");
    const conflict = m.waits.find((wait) => wait.kind === "conflict");
    expect(conflict?.canReview).toBe(false);
    expect(m.waits.filter((wait) => wait.kind === "review")).toHaveLength(0);
    expect(m.rows.find((row) => row.changeId === "zzzzzzzz")?.line).toContain("conflict");
  });

  it("says undo, resolve and the integration preview where they are", () => {
    expect(CHANGES_WORDS.readOnly).toBe(
      "Read-only on the phone. Undo and resolve run on the computer that holds the change. Conflicts between changes are on the integration preview.",
    );
  });

  it("shows a change with two versions with both ids", () => {
    const two = change("mspqrmyv", { task: "ORD-12", subject: "ORD-12: Loyalty", divergent: true });
    const m = model(status(), view([two]));
    if (m.kind !== "ready") throw new Error("expected ready");
    expect(m.twoVersions[0]).toMatchObject({
      title: "ORD-12 has two versions at once",
      versionIds: ["mspqrmyv/0", "mspqrmyv/1"],
    });
  });
});

describe("the honest states", () => {
  const jj = (extra: Partial<JujutsuState>): JujutsuState => ({
    connection: "problem",
    agentWorkspaces: 0,
    protection: true,
    ...extra,
  });

  it("names jj's problem with its fix instead of a broken view", () => {
    const old = model(status({ jujutsu: jj({ problem: "tooOld", version: "0.38.0" }) }), undefined);
    expect(old).toMatchObject({ kind: "jj", note: { fix: "brew upgrade jj" } });
    if (old.kind === "jj") expect(old.note.title).toBe("jj 0.38.0 is older than Peer needs");
    expect(model(status({ jujutsu: jj({ problem: "missing" }) }), undefined)).toMatchObject({
      kind: "jj",
      note: { fix: "brew install jj", word: "Not available" },
    });
    expect(
      model(
        status({ jujutsu: jj({ problem: "notColocated", notColocated: ["ordering"] }) }),
        undefined,
      ),
    ).toMatchObject({ kind: "jj", note: { fix: "jj git colocation enable" } });
  });

  it("says an older Hub, loading, empty and jj failures", () => {
    expect(model(status({ hubSupport: "unsupported" }), undefined).kind).toBe("hubOlder");
    expect(model(status(), undefined).kind).toBe("loading");
    expect(model(status(), view([]))).toMatchObject({
      kind: "empty",
      title: "No changes in flight",
    });
    expect(
      model(status(), view([], { problems: [{ workspace: "ORD-12-3f2a", message: "stale" }] })),
    ).toMatchObject({ kind: "failed", title: "jj failed in ORD-12-3f2a" });
  });

  it("says a failed read only while no view has arrived", () => {
    expect(model(status(), undefined, "offline")).toEqual({
      kind: "readFailed",
      message: "offline",
    });
    expect(model(status(), view([ORD14]), "offline").kind).toBe("ready");
  });
});

describe("a task's changes", () => {
  const input = (taskKey: string, s = status(), v: ProjectChanges | null = view([ORD11, ORD12])) =>
    phoneTaskChanges({ status: s, project: project(s), taskKey, view: v ?? undefined, now: NOW });

  it("stacks the task's change on the one it builds on, the teammate's read-only", () => {
    const stack = input("ORD-12");
    if (stack.kind !== "stack") throw new Error("expected a stack");
    expect(stack.rows.map((row) => [row.title, row.readOnly])).toEqual([
      ["ORD-12 Loyalty points", false],
      ["ORD-11 Receipt totals in cents", true],
    ]);
  });

  it("shows nothing for a task no change reports, or before the view arrives", () => {
    expect(input("ORD-99")).toEqual({ kind: "none" });
    expect(input("ORD-12", status(), null)).toEqual({ kind: "none" });
  });

  it("names jj's problem on the task page too", () => {
    const s = status({
      jujutsu: {
        connection: "notAvailable",
        problem: "missing",
        agentWorkspaces: 0,
        protection: true,
      },
    });
    expect(input("ORD-12", s)).toMatchObject({ kind: "jj", fix: "brew install jj" });
  });
});

describe("a review's files", () => {
  const diff = (extra: Partial<ReviewDiff>): ReviewDiff => ({
    state: "ok",
    mode: "since",
    files: [{ path: "order.js", added: 3, removed: 0, lines: [] }],
    ...extra,
  });

  it("lists the files with what moved", () => {
    expect(phoneReviewDiff(diff({}))).toEqual({
      notes: [],
      files: [{ path: "order.js", stat: "+3" }],
    });
  });

  it("says a partial compare, a version that is not here and what trunk gained", () => {
    expect(phoneReviewDiff(diff({ state: "partial", toVersion: 6, leftOut: 2 })).notes).toEqual([
      "Compared up to v6, the newest this computer has.",
      "2 commits trunk gained in between are left out.",
    ]);
    expect(phoneReviewDiff(diff({ state: "notHere", files: [] })).notes[0]).toMatch(
      /not on this computer/,
    );
    expect(phoneReviewDiff(diff({ files: [] })).notes).toEqual(["Nothing moved."]);
  });
});
