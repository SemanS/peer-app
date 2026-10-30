import type { PeerHubStatus, PeerProjectState, PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { dependencyRows, toggleInput } from "./dependencies.logic";
describe("dependency menu choices", () => {
  it("reverses an existing edge without optimistic edits", () => {
    expect(toggleInput("a", true)).toEqual({ remove: ["a"] });
    expect(toggleInput("a", false)).toEqual({ add: ["a"] });
  });
});

describe("what a dependency still lacks", () => {
  const task = (id: string, status: PeerTask["status"]): PeerTask => ({
    id,
    key: id.toUpperCase(),
    title: id,
    status,
    createdAt: "",
    updatedAt: "",
    createdBy: "ana@acme.test",
  });
  const project = {
    project: { id: "app" },
    work: {
      tasks: [
        task("vl1", "review"),
        task("vl2", "open"),
        task("vl4", "review"),
        task("vl5", "open"),
      ],
      threads: [],
    },
  } as unknown as PeerProjectState;
  const delivered = (id: string, state: "shared" | "none") => ({
    workspace: "acme",
    project: "app",
    task: id,
    author: "ana@acme.test",
    number: 1,
    composedAt: "2026-10-30T09:00:00Z",
    contextVersion: null,
    pullRequests: 0,
    source: "agent",
    delivery: {
      state,
      evidence: {},
      observedAt: "2026-10-30T09:00:00Z",
      environment: "env",
      vcs: "git",
    },
  });
  const status = (available: boolean) =>
    ({
      handoff: {
        target: "none",
        projectTargets: {},
        summaries: [delivered("vl1", "shared"), delivered("vl4", "none")],
        deliveries: [],
      },
      acceptance: { accepted: [] },
      dependencies: [
        { workspace: "acme", available, projects: { app: { vl2: ["vl1", "vl4"], vl5: ["vl2"] } } },
      ],
    }) as unknown as PeerHubStatus;

  it("says per dependency what it lacks and when the task is ready, and who waits for it", () => {
    expect(dependencyRows(status(true), "acme", project, "vl2")).toEqual({
      dependsOn: [
        { id: "vl1", line: "VL1 · shared in flight" },
        { id: "vl4", line: "VL4 · not yet delivered" },
      ],
      readyWhen: "ready when VL4 also lands",
      neededBy: [{ key: "vl5", line: "VL5 · ready" }],
    });
  });

  it("says nothing with the dependencies plugin off", () => {
    expect(dependencyRows(status(false), "acme", project, "vl2")).toBeNull();
  });
});
