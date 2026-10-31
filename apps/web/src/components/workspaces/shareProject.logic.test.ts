import { EnvironmentId, ProjectId, type PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shareRowNote, shareRows } from "./shareProject.logic";

const environmentId = EnvironmentId.make("laptop");
const local = (id: string) => ({ id: ProjectId.make(id), environmentId });
const workspaces = [
  {
    name: "Vocabulift",
    projects: [{ repositories: [{ projectId: "shared" }, { projectId: undefined }] }],
  },
] as unknown as PeerHubStatus["workspaces"];

describe("shareRows", () => {
  it("puts the open project first, then what can be shared, then what is shared", () => {
    const rows = shareRows(
      [local("shared"), local("other"), local("open")],
      [{ environmentId, projectId: ProjectId.make("open") }],
      workspaces,
    );
    expect(rows.map((row) => [row.project.id, row.open, row.sharedWith])).toEqual([
      ["open", true, []],
      ["other", false, []],
      ["shared", false, ["Vocabulift"]],
    ]);
  });

  it("marks nothing open under all projects", () => {
    expect(shareRows([local("other")], null, workspaces).map((row) => row.open)).toEqual([false]);
  });

  it("does not take the same project id on another computer for the open one", () => {
    const rows = shareRows(
      [local("open")],
      [{ environmentId: EnvironmentId.make("desktop"), projectId: ProjectId.make("open") }],
      workspaces,
    );
    expect(rows[0]?.open).toBe(false);
  });
});

describe("shareRowNote", () => {
  it("says only what tells a row apart", () => {
    expect(shareRowNote({ open: false, sharedWith: [] })).toBeNull();
    expect(shareRowNote({ open: true, sharedWith: [] })).toBe("Open now");
    expect(shareRowNote({ open: false, sharedWith: ["Vocabulift"] })).toBe(
      "Shared with Vocabulift",
    );
    expect(shareRowNote({ open: true, sharedWith: ["Vocabulift"] })).toBe(
      "Open now, shared with Vocabulift",
    );
  });
});
