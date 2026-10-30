import { describe, expect, it } from "@effect/vitest";
import {
  coordinationEventLabel,
  coordinationActorLabel,
  coordinationRunLabel,
  coordinationTimeline,
  groupRepeated,
  staleInputLine,
  staleInputSummary,
  inputReadiness,
  coordinationScopeLabel,
} from "./coordinationTimeline.ts";

describe("coordination history", () => {
  it("names an event's run quietly by its random tail, and nothing without one", () => {
    expect(coordinationRunLabel({ run: "run_01JBX0000000K3F9QZAB" })).toBe("run …F9QZAB");
    expect(coordinationRunLabel({})).toBeUndefined();
  });

  it("does not present missing or empty receipts as current inputs", () => {
    expect(inputReadiness({ fresh: true, stale: [] })).toBe("unknown");
    expect(inputReadiness({ fresh: true, reads: [], stale: [] })).toBe("empty");
    expect(
      inputReadiness({
        fresh: true,
        reads: [
          {
            project: "app",
            scope: "project",
            session: "b",
            environment: "mac",
            version: 2,
            at: "",
          },
        ],
        stale: [],
      }),
    ).toBe("current");
  });
  it("keeps a deleted context visibly stale and names the task", () => {
    const inputs = {
      fresh: false,
      reads: [],
      stale: [
        {
          project: "app",
          scope: "task:123",
          readVersion: 2,
          currentVersion: null,
          at: "",
          updatedAt: null,
        },
      ],
    };
    expect(inputReadiness(inputs)).toBe("stale");
    expect(staleInputSummary(inputs)).toBe("123 v2 → removed");
    expect(
      coordinationScopeLabel("task:123", [{ id: "123", title: "Board filters", key: "LP-1" }]),
    ).toBe("LP-1 · Board filters");
    expect(coordinationScopeLabel("project", [])).toBe("Project context");
  });
  it("names each changed input, with the version read and what it is now", () => {
    const tasks = [{ id: "shp-6", title: "Refund flow", key: "SHP-6" }];
    expect(staleInputLine({ scope: "task:shp-6", readVersion: 2, currentVersion: 3 }, tasks)).toBe(
      "SHP-6 · Refund flow: read v2 → v3",
    );
    expect(
      staleInputLine({ scope: "task:shp-6", readVersion: 2, currentVersion: null }, tasks),
    ).toBe("SHP-6 · Refund flow: read v2 → removed");
    expect(staleInputLine({ scope: "project", readVersion: 1, currentVersion: 4 }, [])).toBe(
      "Project context: read v1 → v4",
    );
  });
  it("preserves one event and its participants when updates arrive out of order", () => {
    const one = {
      id: "a",
      kind: "context-write",
      project: "app",
      at: "2026-10-06T10:00:00Z",
      version: 3,
      paths: [],
      participants: ["claude:a", "codex:b"],
    };
    const two = { ...one, id: "b", at: "2026-10-06T10:01:00Z" };
    expect(coordinationTimeline([two, one, two])).toEqual([two, one]);
    expect(coordinationEventLabel(one)).toBe("Shared context updated · v3");
  });
  it("shows exact stale versions and preserves unknown event kinds", () => {
    expect(
      staleInputSummary({
        fresh: false,
        stale: [
          {
            project: "app",
            scope: "task:build",
            readVersion: 2,
            currentVersion: 4,
            at: "",
            updatedAt: "",
          },
        ],
      }),
    ).toBe("build v2 → v4");
    expect(
      coordinationEventLabel({
        id: "a",
        kind: "future",
        project: "app",
        at: "",
        paths: [],
        participants: [],
      }),
    ).toBe("future");
  });
});

it("labels announcement ledger changes and automation without exposing a credential secret", () => {
  const event = {
    id: "event",
    kind: "announcement",
    project: "app",
    at: "2026-10-09T00:00:00Z",
    paths: [],
    participants: ["announcement:aaa", "credential:CI"],
  };
  expect(coordinationEventLabel(event)).toBe("Announcement posted");
  expect(coordinationActorLabel(event, [])).toBe("CI (automated)");
  expect(coordinationEventLabel({ ...event, kind: "announcement-withdrawn" })).toBe(
    "Announcement withdrawn",
  );
});

it("labels resource events and preserves unknown event kinds", () => {
  const event = {
    id: "r",
    kind: "resource-claim",
    project: "app",
    at: "",
    paths: [],
    participants: [],
  };
  expect(coordinationEventLabel(event)).toBe("Held a resource");
  expect(coordinationEventLabel({ ...event, kind: "resource-release" })).toBe(
    "Released a resource",
  );
  expect(coordinationEventLabel({ ...event, kind: "future-kind" })).toBe("future-kind");
});

it("labels task status, removal and verified merge facts on both clients", () => {
  const base = { id: "e", project: "app", at: "time", paths: [], participants: [] };
  expect(coordinationEventLabel({ ...base, kind: "task-status", status: "review" })).toBe(
    "Task moved to review",
  );
  expect(coordinationEventLabel({ ...base, kind: "task-removed" })).toBe("Task removed");
  expect(coordinationEventLabel({ ...base, kind: "pr-merged" })).toBe("Pull request merged");
});

it("folds neighbouring repeats and never an item without a key", () => {
  const groups = groupRepeated(["a", "a", "b", "a", "x", "x"], (item) =>
    item === "x" ? null : item,
  );
  expect(groups.map(({ item, count }) => [item, count])).toEqual([
    ["a", 2],
    ["b", 1],
    ["a", 1],
    ["x", 1],
    ["x", 1],
  ]);
});
