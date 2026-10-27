import { describe, expect, it } from "vite-plus/test";
import type { PeerContextView, PeerHubStatus } from "@t3tools/contracts";
import { contextFromStatus, contextViewRevision, currentContextSections } from "./contextView.ts";

const fixture = () => ({
  environmentId: "environment",
  hubUrl: "https://hub.example",
  signedIn: true,
  email: "ana@example.test",
  workspaces: [
    {
      slug: "team",
      role: "member",
      error: null as string | null,
      lastSyncAt: "old",
      projects: [
        {
          project: { id: "app", members: [{ email: "ana@example.test", name: "Ana" }] },
          work: { tasks: [{ id: "task", title: "Work", status: "open", updatedAt: "one" }] },
        },
      ],
    },
  ],
  coordination: {
    enabled: true,
    local: { available: true },
    contexts: [
      {
        workspace: "team",
        project: "app",
        scope: "project",
        version: 3,
        bytes: 80,
        updatedAt: "one",
        epoch: 1,
        keeper: {
          session: "keeper",
          environment: "environment",
          email: "ana@example.test",
          since: "one",
        },
      },
    ],
    findings: [
      {
        workspace: "team",
        project: "app",
        id: "finding",
        text: "Check it",
        email: "ana@example.test",
        at: "one",
        decision: undefined as { status: string; reason: string } | undefined,
      },
    ],
    sessions: [
      {
        workspace: "team",
        project: "app",
        id: "keeper",
        environment: "environment",
        runtimeGeneration: "one",
        task: "task",
        status: "working",
        activeAt: "one",
      },
    ],
    advice: [
      {
        workspace: "team",
        project: "app",
        session: "keeper",
        scope: "project",
        how: "read",
        why: "Read v3",
        at: "one",
      },
    ],
  },
});
const key = (status: ReturnType<typeof fixture>) =>
  contextViewRevision(status as unknown as PeerHubStatus, "team", "app");

describe("context view status revision", () => {
  it("invalidates relevant task, finding, keeper, read and permission changes", () => {
    const before = key(fixture());
    const mutations = [
      (status: ReturnType<typeof fixture>) => {
        status.workspaces[0]!.projects[0]!.work.tasks[0]!.status = "done";
      },
      (status: ReturnType<typeof fixture>) => {
        status.coordination.findings[0]!.decision = { status: "dismissed", reason: "Checked" };
      },
      (status: ReturnType<typeof fixture>) => {
        status.coordination.findings.push({
          ...status.coordination.findings[0]!,
          id: "new-finding",
        });
      },
      (status: ReturnType<typeof fixture>) => {
        status.coordination.contexts[0]!.keeper.session = "new-keeper";
      },
      (status: ReturnType<typeof fixture>) => {
        status.coordination.advice[0]!.why = "Read another input";
      },
      (status: ReturnType<typeof fixture>) => {
        status.workspaces[0]!.role = "owner";
      },
      (status: ReturnType<typeof fixture>) => {
        status.workspaces[0]!.error = "Access revoked";
      },
      (status: ReturnType<typeof fixture>) => {
        status.coordination.sessions[0]!.runtimeGeneration = "two";
      },
    ];
    for (const mutate of mutations) {
      const status = fixture();
      mutate(status);
      expect(key(status)).not.toBe(before);
    }
  });
  it("ignores heartbeat clocks and another project's updates", () => {
    const status = fixture();
    const before = key(status);
    status.workspaces[0]!.lastSyncAt = "later";
    status.coordination.sessions[0]!.activeAt = "later";
    status.coordination.contexts.push({
      ...status.coordination.contexts[0]!,
      project: "other",
      version: 9,
    });
    status.coordination.findings.push({
      ...status.coordination.findings[0]!,
      project: "other",
      id: "other",
    });
    expect(key(status)).toBe(before);
  });
  it("projects canonical archived and Local metadata without an active board node", () => {
    const status = fixture();
    status.workspaces = [];
    status.coordination.contexts[0]!.workspace = "@local";
    status.coordination.contexts[0]!.keeper.email = "local";
    const context = contextFromStatus(
      status as unknown as PeerHubStatus,
      "@local",
      "app",
      "project",
    );
    expect(context).toMatchObject({
      version: 3,
      tokens: 20,
      keeper: { person: "You", mine: true },
    });
  });
});

describe("current context sections", () => {
  it("names each run of values from the same sources once", () => {
    const source = (id: string, revision: string | null) => ({
      id,
      kind: "context" as const,
      objectId: "project",
      scope: "project",
      revision,
      observedAt: "now",
      availability: "available" as const,
    });
    const view = {
      current: {
        goal: [],
        outcome: [{ text: "Imported", detail: "- a → b", sourceRefs: ["one"] }],
        attention: [],
        next: [
          { text: "Review", sourceRefs: ["one"] },
          { text: "Merge", sourceRefs: ["one"] },
          { text: "Ship", sourceRefs: ["two"] },
        ],
      },
      sources: [source("one", "1"), source("two", null)],
    } as unknown as PeerContextView;
    const sections = currentContextSections(view);
    expect(sections.map((section) => section.title)).toEqual(["Reported outcome", "Next step"]);
    expect(sections[0]?.groups[0]?.values[0]?.detail).toBe("- a → b");
    expect(
      sections[1]?.groups.map((group) => [
        group.values.map((value) => value.text),
        group.sources.map((source) => source.label),
      ]),
    ).toEqual([
      [["Review", "Merge"], ["project @ 1"]],
      [["Ship"], ["project"]],
    ]);
  });
});
