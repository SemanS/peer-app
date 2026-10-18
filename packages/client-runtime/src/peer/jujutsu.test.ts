import { describe, expect, it } from "vite-plus/test";
import type { JujutsuOperation, JujutsuState, UndoPreview } from "@t3tools/contracts";
import {
  filterOperations,
  groupOperations,
  jujutsuProblem,
  jujutsuSettingsLine,
  jujutsuWord,
  operationActor,
  operationActors,
  undoDialog,
} from "./jujutsu.ts";

const op = (
  id: string,
  user: string,
  time: string,
  description: string,
  args: string,
  changed: string[] = [],
): JujutsuOperation => ({
  id,
  user,
  time: `2026-10-18T${time}Z`,
  description,
  args,
  changed,
});

describe("jj state in words", () => {
  const state = (over: Partial<JujutsuState>): JujutsuState => ({
    connection: "connected",
    version: "0.46.0",
    agentWorkspaces: 2,
    protection: true,
    ...over,
  });

  it("says Settings' row in Peer's connection words", () => {
    expect(jujutsuSettingsLine(state({}))).toBe("Connected · jj 0.46.0 · 2 agent workspaces");
    expect(jujutsuSettingsLine(state({ agentWorkspaces: 1 }))).toBe(
      "Connected · jj 0.46.0 · 1 agent workspace",
    );
    expect(jujutsuWord(state({ connection: "off" }))).toBe("Off");
    expect(jujutsuWord(state({ connection: "notAvailable", problem: "missing" }))).toBe(
      "Not available",
    );
    expect(jujutsuWord(state({ connection: "notAvailable", problem: "tooOld" }))).toBe("Problem");
    expect(jujutsuSettingsLine(undefined)).toBe("Off");
  });

  it("has no problem while connected, off or unread", () => {
    expect(jujutsuProblem(state({}), "ordering")).toBeNull();
    expect(jujutsuProblem(state({ connection: "off" }))).toBeNull();
    expect(jujutsuProblem(undefined)).toBeNull();
  });
});

describe("the operation log", () => {
  it("reads who took a step", () => {
    expect(operationActor("bob")).toMatchObject({ kind: "person", label: "Bob" });
    expect(operationActor("bob·codex")).toMatchObject({
      kind: "agent",
      person: "bob",
      agent: "codex",
      label: "Bob · Codex",
    });
    expect(operationActor("peer·follow")).toMatchObject({
      kind: "peer",
      step: "follow",
      label: "Peer, following",
    });
    expect(operationActor("peer·check").label).toBe("Peer's check");
  });

  const log = [
    op(
      "f4",
      "peer·follow",
      "14:55:52",
      "fetch from git remote(s) origin",
      "jj git fetch -b feature/ORD-11-cents",
      ["lrorvllt"],
    ),
    op("c3", "peer·check", "14:54:40", "abandon commit", "jj abandon x"),
    op("c2", "peer·check", "14:54:30", "run", "jj run -- sh -c 'npm test'"),
    op("c1", "peer·check", "14:54:00", "new empty commit", "jj new --no-edit a b"),
    op("r1", "bob·codex", "14:55:48", "restore into commit ac8515ad", "jj restore", ["mspqrmyv"]),
  ];

  it("groups a check's steps into one row and keeps every other step alone", () => {
    const groups = groupOperations(log);
    expect(groups.map((g) => g.id)).toEqual(["f4", "c3", "r1"]);
    expect(groups[1]?.title).toBe("Checked a merge in a throwaway change");
    expect(groups[1]?.commands).toEqual([
      "jj new --no-edit a b",
      "jj run -- sh -c 'npm test'",
      "jj abandon x",
    ]);
    expect(groups[2]?.title).toBe("restore into commit ac8515ad");
  });

  it("filters to one agent's steps or Peer's own", () => {
    const groups = groupOperations(log);
    expect(filterOperations(groups, { kind: "all" })).toHaveLength(3);
    expect(filterOperations(groups, { kind: "peer" }).map((g) => g.id)).toEqual(["f4", "c3"]);
    expect(filterOperations(groups, { kind: "actor", user: "bob·codex" }).map((g) => g.id)).toEqual(
      ["r1"],
    );
    expect(operationActors(log)).toEqual([{ user: "bob·codex", label: "Bob · Codex" }]);
  });

  it("does not join follow steps that are far apart", () => {
    const apart = [
      op("b", "peer·follow", "14:59:00", "rebase", "jj rebase"),
      op("a", "peer·follow", "14:55:00", "fetch", "jj git fetch"),
    ];
    expect(groupOperations(apart)).toHaveLength(2);
    const close = [
      op("b", "peer·follow", "14:55:05", "rebase", "jj rebase"),
      op("a", "peer·follow", "14:55:00", "fetch", "jj git fetch"),
    ];
    expect(groupOperations(close)).toHaveLength(1);
  });
});

describe("the undo dialog", () => {
  const restore = op(
    "7a867867a1ed",
    "bob·codex",
    "14:55:48",
    "restore into commit ac8515ad",
    "jj restore",
    ["mspqrmyv"],
  );
  const fetch = op(
    "9b",
    "peer·follow",
    "14:55:52",
    "fetch from git remote(s) origin",
    "jj git fetch",
    ["mspqrmyv"],
  );

  it("names the later step and the two commands", () => {
    const preview: UndoPreview = {
      operation: restore,
      later: [fetch],
      shared: ["mspqrmyv"],
      commands: ["jj op revert 7a867867a1ed", "jj converge --no-interactive -r mspqrmyv"],
    };
    const dialog = undoDialog(preview);
    expect(dialog.warning).toBe("A later step touched the same change");
    expect(dialog.mergeNote).toBe("Peer will merge the two versions afterwards.");
    expect(dialog.later[0]?.line).toBe("Peer, following: fetch from git remote(s) origin");
    expect(dialog.commands).toHaveLength(2);
  });

  it("shows only the revert when nothing touched it later, and says an unread log", () => {
    const quiet = undoDialog({
      operation: restore,
      later: [],
      shared: [],
      commands: ["jj op revert 7a867867a1ed"],
    });
    expect(quiet.warning).toBeUndefined();
    expect(quiet.commands).toEqual(["jj op revert 7a867867a1ed"]);
    const unread = undoDialog({
      operation: restore,
      later: [],
      shared: [],
      commands: [],
      changedUnread: true,
    });
    expect(unread.unread).toBe("Peer could not read what later steps changed. You can still undo.");
  });
});
