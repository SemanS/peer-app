import type { PeerHubStatus, PeerProjectState, PeerWorkspaceState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { peerProjectIndex } from "./projectScope.logic";

function project(id: string, name: string, opened: ReadonlyArray<string | undefined>) {
  return {
    project: { id, name },
    repositories: opened.map((projectId, index) => ({ id: `repo-${index}`, projectId })),
  } as unknown as PeerProjectState;
}

function status(
  environmentId: string,
  workspaces: ReadonlyArray<{ slug: string; projects: ReadonlyArray<PeerProjectState> }>,
): Pick<PeerHubStatus, "environmentId" | "workspaces"> {
  return {
    environmentId,
    workspaces: workspaces as unknown as ReadonlyArray<PeerWorkspaceState>,
  };
}

describe("peerProjectIndex", () => {
  it("keys each workspace project by its scope and lists where its repositories are open here", () => {
    const index = peerProjectIndex(
      status("laptop", [
        {
          slug: "webinson",
          projects: [
            project("ordering", "Ordering demo", ["p-1", "p-2"]),
            project("receipts", "Receipt printer", [undefined, "p-3"]),
          ],
        },
        { slug: "acme", projects: [project("app", "App", ["p-4"])] },
      ]),
    );
    expect(index.map((entry) => [entry.scope, entry.name])).toEqual([
      ["webinson/ordering", "Ordering demo"],
      ["webinson/receipts", "Receipt printer"],
      ["acme/app", "App"],
    ]);
    expect(
      index.map((entry) => entry.refs.map((ref) => `${ref.environmentId}:${ref.projectId}`)),
    ).toEqual([["laptop:p-1", "laptop:p-2"], ["laptop:p-3"], ["laptop:p-4"]]);
  });

  it("knows no project before the Hub's status has arrived", () => {
    expect(peerProjectIndex(null)).toEqual([]);
  });

  it("has no refs for a status that names no environment", () => {
    const index = peerProjectIndex(
      status("", [{ slug: "webinson", projects: [project("ordering", "Ordering", ["p-1"])] }]),
    );
    expect(index).toEqual([{ scope: "webinson/ordering", name: "Ordering", refs: [] }]);
  });
});
