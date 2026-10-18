import { groupOperations } from "@t3tools/client-runtime/peer/jujutsu";
import type { JujutsuOperation, JujutsuState, UndoPreview } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  atOpHeading,
  atOpRowView,
  clockTime,
  filterChoices,
  filterValue,
  operationRows,
  operationsAsked,
  operationsPage,
  parseFilter,
  stepOwner,
  undoDialogView,
  undoSummary,
  visibleGroups,
  youOf,
} from "./operations.logic";

const op = (over: Partial<JujutsuOperation> & Pick<JujutsuOperation, "id" | "time">) => ({
  user: "bob·codex",
  workspace: "ORD-12-3f2a1b2c",
  description: "",
  args: "",
  changed: [] as string[],
  ...over,
});

/** Bob's computer as the canvas draws it, newest first. */
const log: ReadonlyArray<JujutsuOperation> = [
  op({
    id: "f1",
    time: "2026-10-18T14:55:52Z",
    user: "peer·follow",
    description: "fetch from git remote(s) origin",
    args: "jj git fetch -b feature/ORD-11-cents",
    changed: ["lrorvllt", "mspqrmyv"],
  }),
  op({
    id: "7a867867a1ed",
    time: "2026-10-18T14:55:48Z",
    description: "restore into commit ac8515ad",
    args: "jj restore",
    changed: ["mspqrmyv"],
  }),
  op({
    id: "s1",
    time: "2026-10-18T14:55:30Z",
    description: "snapshot working copy",
    args: "jj util snapshot",
    changed: ["mspqrmyv"],
  }),
  op({
    id: "c3",
    time: "2026-10-18T14:52:31Z",
    user: "peer·check",
    description: "abandon commit",
    args: "jj abandon",
  }),
  op({
    id: "c2",
    time: "2026-10-18T14:52:30Z",
    user: "peer·check",
    description: "run",
    args: "jj run --ignore-changes",
  }),
  op({
    id: "c1",
    time: "2026-10-18T14:52:29Z",
    user: "peer·check",
    description: "new empty commit",
    args: "jj new --no-edit lrorvllt mspqrmyv",
  }),
  op({
    id: "d1",
    time: "2026-10-18T14:52:01Z",
    description: "describe commit 63bb9a9a",
    args: "jj describe -m 'ORD-12: loyalty points'",
    changed: ["mspqrmyv"],
  }),
];

const jj = { project: { id: "ordering" }, repositories: [{ vcs: "jj" as const, state: "ready" }] };
const connected: JujutsuState = {
  connection: "connected",
  version: "0.46.0",
  agentWorkspaces: 2,
  protection: true,
};

describe("which state the page is in", () => {
  const read = { loaded: true, error: null, count: 3 };

  it("shows the log for a colocated jj checkout", () => {
    expect(operationsPage({ project: jj, state: connected, read })).toEqual({ kind: "ready" });
    expect(operationsPage({ project: jj, state: connected, read: { ...read, count: 0 } })).toEqual({
      kind: "empty",
    });
  });

  it("says a Git checkout needs a Jujutsu one, and asks for no log", () => {
    const git = { ...jj, repositories: [{ vcs: "git" as const, state: "ready" }] };
    const page = operationsPage({ project: git, state: connected, read });
    expect(page).toEqual({ kind: "git" });
    expect(operationsAsked(page.kind)).toBe(false);
  });

  it("names a jj that is missing, too old, or has no .git beside it", () => {
    const missing = operationsPage({
      project: jj,
      state: { ...connected, connection: "notAvailable", problem: "missing" },
      read,
    });
    expect(missing).toMatchObject({ kind: "problem", note: { fix: "brew install jj" } });
    const tooOld = operationsPage({
      project: jj,
      state: { ...connected, connection: "notAvailable", problem: "tooOld", version: "0.38.0" },
      read,
    });
    expect(tooOld).toMatchObject({
      kind: "problem",
      note: { title: expect.stringContaining("0.38.0") },
    });
    const bare = operationsPage({
      project: jj,
      state: {
        ...connected,
        connection: "problem",
        problem: "notColocated",
        notColocated: ["ordering"],
      },
      read,
    });
    expect(bare).toMatchObject({ kind: "problem", note: { fix: "jj git colocation enable" } });
  });

  it("waits, fails and does not know the project", () => {
    expect(
      operationsPage({
        project: jj,
        state: connected,
        read: { loaded: false, error: null, count: 0 },
      }),
    ).toEqual({ kind: "loading" });
    expect(
      operationsPage({
        project: jj,
        state: connected,
        read: { loaded: false, error: "gone", count: 0 },
      }),
    ).toEqual({ kind: "failed", message: "gone" });
    expect(operationsPage({ project: undefined, state: connected, read })).toEqual({
      kind: "unknown",
    });
    expect(operationsAsked("loading")).toBe(true);
  });
});

describe("the rows", () => {
  const rows = operationRows(groupOperations(log), { you: "bob", timeZone: "UTC" });

  it("lists newest first, one row for Peer's check and one per other step", () => {
    expect(rows.map((row) => row.time)).toEqual([
      "14:55:52",
      "14:55:48",
      "14:55:30",
      "14:52:31",
      "14:52:01",
    ]);
    const check = rows[3];
    expect(check).toMatchObject({
      title: "Checked a merge in a throwaway change",
      actor: { label: "Peer's check", detail: "peer·check · ORD-12-3f2a1b2c@" },
      commands: "jj new --no-edit lrorvllt mspqrmyv · jj run --ignore-changes · jj abandon",
      note: "3 operations, shown as one. Nobody's work changed.",
      undo: null,
    });
  });

  it("names Peer's follow and the agent, with the user and the workspace in detail", () => {
    expect(rows[0]?.actor).toEqual({
      label: "Peer, following",
      initial: "P",
      detail: "peer·follow · ORD-12-3f2a1b2c@",
    });
    expect(rows[1]?.actor).toEqual({
      label: "Bob · Codex",
      initial: "B",
      detail: "bob·codex · ORD-12-3f2a1b2c@",
    });
  });

  it("offers undo on Codex's restore only, not on Peer's steps or a snapshot", () => {
    expect(rows[1]?.undo).toEqual({
      operation: "7a867867a1ed",
      description: "restore into commit ac8515ad",
    });
    expect(rows.filter((row) => row.undo !== null)).toHaveLength(2); // the restore and the describe
    expect(rows[0]?.undo).toBeNull();
    expect(rows[2]?.undo).toBeNull();
    expect(rows[2]?.note).toBe("Peer wrote the working copy down after a tool step");
  });

  it("gives each row the view after it and, when there is one, the view before it", () => {
    expect(rows[1]?.view).toEqual({ after: "7a867867a1ed", before: "s1" });
    expect(rows[4]?.view).toEqual({ after: "d1", before: null });
  });

  it("says 'you' on the person's own steps", () => {
    const own = operationRows(
      groupOperations([op({ id: "x", time: "2026-10-18T10:00:00Z", user: "bob" })]),
      { you: youOf("Bob@acme.test"), timeZone: "UTC" },
    );
    expect(own[0]?.actor.label).toBe("Bob, you");
  });

  it("reads the clock the way the canvas does", () => {
    expect(clockTime("2026-10-18T14:55:52Z", "UTC")).toBe("14:55:52");
    expect(clockTime("not a time")).toBe("not a time");
  });
});

describe("the filter", () => {
  const choices = filterChoices(log);

  it("offers every step, each agent, and Peer's own", () => {
    expect(choices).toEqual([
      { value: "all", label: "Every step on this computer" },
      { value: "actor:bob·codex", label: "Bob · Codex" },
      { value: "peer", label: "Peer's own steps" },
    ]);
  });

  it("shows one agent's steps, or Peer's", () => {
    const groups = groupOperations(log);
    expect(visibleGroups(groups, "actor:bob·codex").map((g) => g.id)).toEqual([
      "7a867867a1ed",
      "s1",
      "d1",
    ]);
    expect(visibleGroups(groups, "peer").map((g) => g.id)).toEqual(["f1", "c3"]);
    expect(visibleGroups(groups, "all")).toHaveLength(5);
    expect(parseFilter("actor:bob·codex")).toEqual({ kind: "actor", user: "bob·codex" });
  });

  it("falls back to every step when the chosen one is gone", () => {
    expect(filterValue("actor:ana", choices)).toBe("all");
    expect(filterValue("peer", choices)).toBe("peer");
  });

  it("does not offer Peer's steps when there are none", () => {
    expect(filterChoices([log[1] as JujutsuOperation]).map((c) => c.value)).toEqual([
      "all",
      "actor:bob·codex",
    ]);
  });
});

describe("the undo dialog", () => {
  const restore = log[1] as JujutsuOperation;
  const touched: UndoPreview = {
    operation: restore,
    later: [log[0] as JujutsuOperation],
    shared: ["mspqrmyv"],
    commands: ["jj op revert 7a867867a1ed", "jj converge --no-interactive -r mspqrmyv"],
  };

  it("names the later step and the two commands, and merges afterwards", () => {
    const view = undoDialogView(touched, { you: "bob", timeZone: "UTC" });
    expect(view.heading).toBe("Undo Codex's step?");
    expect(view.step).toBe("restore into commit ac8515ad · jj restore · 14:55:48 · bob·codex");
    expect(view.warning).toEqual({
      title: "A later step touched the same change",
      later: [{ id: "f1", line: "Peer, following: fetch from git remote(s) origin" }],
      merge: "Peer will merge the two versions afterwards.",
    });
    expect(view.commands).toEqual([
      "jj op revert 7a867867a1ed",
      "jj converge --no-interactive -r mspqrmyv",
    ]);
    expect(view.confirm).toBe("Undo and converge");
    expect(view.note).toBe(
      "Both steps go into the log under your name and can be undone the same way. Codex is told at its next step.",
    );
  });

  it("shows only the revert when nothing touched it later", () => {
    const view = undoDialogView(
      { ...touched, later: [], shared: [], commands: ["jj op revert 7a867867a1ed"] },
      { you: "bob", timeZone: "UTC" },
    );
    expect(view.warning).toBeNull();
    expect(view.commands).toEqual(["jj op revert 7a867867a1ed"]);
    expect(view.confirm).toBe("Undo");
  });

  it("says when Peer could not read what later steps changed, and still allows the undo", () => {
    const view = undoDialogView({ ...touched, later: [], changedUnread: true }, { you: null });
    expect(view.unread).toBe("Peer could not read what later steps changed. You can still undo.");
  });

  it("names a person's step as yours or theirs", () => {
    expect(stepOwner("bob", "bob")).toBe("your step");
    expect(stepOwner("ana", "bob")).toBe("Ana's step");
  });
});

describe("what an undo says", () => {
  it("says it converged", () => {
    expect(
      undoSummary(
        { reverted: "7a8", ran: [], converged: ["mspqrmyv"], needsPerson: [] },
        "restore into commit ac8515ad",
      ),
    ).toBe('Undid "restore into commit ac8515ad", then converged mspqrmyv.');
  });

  it("says both versions stay when the merge needs a choice", () => {
    expect(
      undoSummary(
        { reverted: "7a8", ran: [], converged: [], needsPerson: ["mspqrmyv"] },
        "restore",
      ),
    ).toContain("mspqrmyv keeps two versions: the merge needs your choice");
  });
});

describe("the repository as it was", () => {
  it("flags conflicts, two versions and empty changes, and shortens the paths", () => {
    expect(
      atOpRowView({
        changeId: "mspqrmyv",
        commitId: "c",
        parents: [],
        subject: "",
        paths: ["a", "b", "c", "d", "e", "f"],
        bookmarks: ["feature/ORD-12"],
        conflict: true,
        empty: false,
        divergent: true,
      }),
    ).toMatchObject({
      subject: "(no description)",
      flags: ["conflict", "divergent"],
      paths: "a, b, c, d and 2 more",
    });
    expect(atOpHeading("before", "restore")).toContain("just before");
  });
});
