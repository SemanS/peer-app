import { describe, expect, it } from "vite-plus/test";
import type {
  PeerDependencySnapshot,
  PeerHandoffDelivery,
  PeerHubStatus,
  PeerTask,
} from "@t3tools/contracts";

import { dependencyIndex } from "./dependencies.ts";
import {
  dependentsReadiness,
  dependsOnReadiness,
  readinessFacts,
  readinessLine,
  readinessOf,
  readyWhenLine,
} from "./readiness.ts";

const task = (id: string, status: PeerTask["status"] = "open"): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title: id,
  status,
  createdAt: "",
  updatedAt: "",
  createdBy: "ana@acme.test",
});

const delivery = (state: PeerHandoffDelivery["state"]): PeerHandoffDelivery => ({
  state,
  evidence: {},
  observedAt: "2026-10-30T09:00:00Z",
  environment: "env-mac",
  vcs: "git",
});

type Summary = NonNullable<PeerHubStatus["handoff"]>["summaries"][number];
const summary = (
  task: string,
  composedAt: string,
  state?: PeerHandoffDelivery["state"],
  project = "app",
): Summary => ({
  workspace: "acme",
  project,
  task,
  author: "cyril@acme.test",
  number: 1,
  composedAt,
  contextVersion: null,
  pullRequests: 0,
  source: "agent",
  ...(state === undefined ? {} : { delivery: delivery(state) }),
});

const status = (
  summaries: ReadonlyArray<Summary>,
  accepted: ReadonlyArray<string> = [],
): Pick<PeerHubStatus, "handoff" | "acceptance"> => ({
  handoff: { target: "none", projectTargets: {}, summaries, deliveries: [] },
  acceptance: {
    accepted: accepted.map((id) => ({
      workspace: "acme",
      project: "app",
      task: id,
      by: "ana@acme.test",
      at: "2026-10-30T10:00:00Z",
      statusThen: "review",
    })),
  },
});

describe("readinessOf", () => {
  it("reads done, landed, in flight and waiting", () => {
    expect(readinessOf("done", "none")).toBe("done");
    expect(readinessOf("merged", undefined)).toBe("landed");
    expect(readinessOf("review", "landed")).toBe("landed");
    expect(readinessOf("review", "shared")).toBe("in-flight");
    expect(readinessOf("review", "local")).toBe("waiting");
    expect(readinessOf("review", "none")).toBe("waiting");
    // No handoff, or one an older app sent without a delivery.
    expect(readinessOf("open", undefined)).toBe("waiting");
  });
});

describe("readinessFacts", () => {
  it("takes the newest handoff that carries a delivery, and the project's acceptances", () => {
    const facts = readinessFacts(
      status(
        [
          summary("a", "2026-10-30T08:00:00Z", "none"),
          summary("a", "2026-10-30T09:00:00Z", "shared"),
          summary("a", "2026-10-30T10:00:00Z"),
          summary("b", "2026-10-30T09:00:00Z", "landed", "other"),
        ],
        ["a"],
      ),
      "acme",
      "app",
    );
    expect(facts.deliveries.get("a")?.state).toBe("shared");
    expect(facts.deliveries.has("b")).toBe(false);
    expect(facts.accepted.has("a")).toBe(true);
    expect(readinessFacts({}, "acme", "app").deliveries.size).toBe(0);
  });
});

describe("a task's dependencies", () => {
  it("says what each dependency lacks and when the task is ready", () => {
    const snapshot: PeerDependencySnapshot = {
      workspace: "acme",
      available: true,
      projects: { app: { vl2: ["vl1", "vl4"] } },
    };
    const index = dependencyIndex([task("vl1", "review"), task("vl2"), task("vl4", "review")], []);
    const facts = readinessFacts(
      status([
        summary("vl1", "2026-10-30T09:00:00Z", "shared"),
        summary("vl4", "2026-10-30T09:00:00Z", "none"),
      ]),
      "acme",
      "app",
    );
    const { rows, readyWhen } = dependsOnReadiness(snapshot, "app", "vl2", index, facts);
    expect(rows.map(readinessLine)).toEqual(["VL1 · shared in flight", "VL4 · not yet delivered"]);
    expect(readyWhen).toBe("ready when VL4 also lands");
  });

  it("is ready when every dependency is done, landed or in flight, and says nothing without one", () => {
    const snapshot: PeerDependencySnapshot = {
      workspace: "acme",
      available: true,
      projects: { app: { c: ["a", "b", "d"] } },
    };
    const index = dependencyIndex(
      [task("a", "done"), task("b", "review"), task("c"), task("d")],
      [],
    );
    const facts = readinessFacts(
      status([
        summary("b", "2026-10-30T09:00:00Z", "landed"),
        summary("d", "2026-10-30T09:00:00Z", "shared"),
      ]),
      "acme",
      "app",
    );
    const { rows, readyWhen } = dependsOnReadiness(snapshot, "app", "c", index, facts);
    expect(rows.map((row) => row.readiness)).toEqual(["done", "landed", "in-flight"]);
    expect(readyWhen).toBe("ready");
    expect(dependsOnReadiness(snapshot, "app", "a", index, facts)).toEqual({
      rows: [],
      readyWhen: null,
    });
    expect(
      dependsOnReadiness({ ...snapshot, available: false }, "app", "c", index, facts).readyWhen,
    ).toBeNull();
  });

  it("names several dependencies not yet delivered, with no handoff among them", () => {
    expect(
      readyWhenLine([{ task: task("1.2") }, { task: task("1.4") }, { task: task("1.5") }]),
    ).toBe("ready when 1.2, 1.4 and 1.5 also land");
    const snapshot: PeerDependencySnapshot = {
      workspace: "acme",
      available: true,
      projects: { app: { c: ["a", "b"] } },
    };
    const index = dependencyIndex([task("a"), task("b", "review"), task("c")], []);
    const facts = readinessFacts(
      status([summary("b", "2026-10-30T09:00:00Z", "local")]),
      "acme",
      "app",
    );
    expect(dependsOnReadiness(snapshot, "app", "c", index, facts).readyWhen).toBe(
      "ready when A and B also land",
    );
  });
});

describe("a task's dependents", () => {
  it("lists who waits for the handed-off task and what else each still waits for", () => {
    const snapshot: PeerDependencySnapshot = {
      workspace: "acme",
      available: true,
      projects: {
        app: { "3.1": ["1.1", "1.2"], "3.2": ["1.1", "1.2"], "5.1": ["1.1"], "6.1": ["1.1"] },
      },
    };
    const index = dependencyIndex(
      [
        task("1.1", "review"),
        task("1.2"),
        task("3.1"),
        task("3.2"),
        task("5.1"),
        task("6.1", "done"),
      ],
      [],
    );
    const facts = readinessFacts(
      status([summary("1.1", "2026-10-30T09:00:00Z", "none")]),
      "acme",
      "app",
    );
    const groups = dependentsReadiness(snapshot, "app", "1.1", index, facts);
    expect(groups.map((group) => group.line)).toEqual([
      "3.1, 3.2 · ready when 1.2 also lands",
      "5.1 · ready",
    ]);
    expect(groups[0]?.waitingOn.map((row) => row.task.id)).toEqual(["1.2"]);
    expect(dependentsReadiness(snapshot, "app", "3.1", index, facts)).toEqual([]);
  });
});
