import { assert, describe, it } from "@effect/vitest";

import type { PeerProject, PeerWorkThread } from "@t3tools/contracts";

import type { ReportedThread } from "../hub/hubApi.ts";
import { EMPTY_PERSISTED } from "../state/PeerState.ts";
import { taskNamed, workspaceReport } from "./report.ts";

describe("working context", () => {
  it("names a task by its key as a whole token", () => {
    const tasks = [
      { id: "krk-335", key: "KRK-335" },
      { id: "krk-33", key: "KRK-33" },
    ];
    assert.strictEqual(taskNamed(tasks, ["fix/krk-335-dns", undefined]), "krk-335");
    assert.isUndefined(taskNamed(tasks, ["KRK-3350"]));
  });
});

describe("the VCS kind a report carries", () => {
  const persisted = { ...EMPTY_PERSISTED, email: "ana@acme.test" };
  const project = { id: "pay", repositories: [] } as unknown as PeerProject;
  const report = (
    live: ReadonlyArray<ReportedThread>,
    previous: ReadonlyArray<PeerWorkThread> = [],
  ) =>
    workspaceReport({
      workspace: "acme",
      projects: [project],
      persisted,
      environmentId: "ana-laptop",
      previous: new Map([["acme/pay", { areas: [], tasks: [], threads: previous }]]),
      live,
      observable: () => false,
      gitHost: undefined,
      round: 0,
    });

  it("reports a jj thread with its kind, a Git thread without one, and keeps it while dormant", () => {
    const jj = {
      id: "herdr:t1",
      project: "pay",
      title: "a",
      status: "working",
      source: "herdr",
      branch: "feature/KRK-1-ab12",
      vcs: "jj",
    } as const;
    const git = {
      id: "peer:t2",
      project: "pay",
      title: "b",
      status: "working",
      source: "peer",
      branch: "krk-2",
    } as const;
    const [first, second] = report([jj, git]);
    assert.strictEqual(first?.vcs, "jj");
    assert.isFalse(second !== undefined && "vcs" in second);
    const dormant = report(
      [],
      [
        {
          ...jj,
          email: "ana@acme.test",
          environment: "ana-laptop",
          seenAt: "2026-10-18T09:00:00.000Z",
        },
      ],
    );
    assert.strictEqual(dormant[0]?.vcs, "jj");
  });
});
