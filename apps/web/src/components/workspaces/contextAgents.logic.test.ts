import type { PeerHubStatus, PeerStaleReads } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { contextAgents, readState } from "./contextAgents.logic";

const session = (id: string, email: string, task: string | undefined) => ({
  id,
  workspace: "acme",
  project: "booking",
  email,
  environment: `${id}-computer`,
  label: id,
  ...(task === undefined ? {} : { task }),
  status: "working" as const,
  files: [],
  claims: [],
  local: email === "you@acme.test",
});

const status = {
  email: "you@acme.test",
  workspaces: [
    {
      slug: "acme",
      projects: [
        {
          project: {
            id: "booking",
            members: [{ email: "eva@acme.test", name: "Eva" }],
          },
        },
      ],
    },
  ],
  coordination: {
    contexts: [
      {
        workspace: "acme",
        project: "booking",
        scope: "task:bkg-812",
        version: 7,
        keeper: { session: "claude:eva", email: "eva@acme.test", since: "2026-10-10T09:00:00Z" },
      },
    ],
    sessions: [
      session("claude:you", "you@acme.test", "bkg-812"),
      session("claude:eva", "eva@acme.test", "bkg-812"),
      session("claude:other", "eva@acme.test", "krk-515"),
      session("claude:loose", "you@acme.test", undefined),
    ],
  },
} as unknown as PeerHubStatus;

describe("the agents on a task", () => {
  it("lists the keeper first, then the readers, and only the task's agents", () => {
    expect(
      contextAgents(status, { workspace: "acme", project: "booking", scope: "task:bkg-812" }).map(
        (agent) => [agent.name, agent.role, agent.mine],
      ),
    ).toEqual([
      ["Eva’s agent", "keeps", false],
      ["Your agent", "reads", true],
    ]);
  });

  it("puts the agents on no task under the project's shared context", () => {
    expect(
      contextAgents(status, { workspace: "acme", project: "booking", scope: "project" }).map(
        (agent) => agent.session,
      ),
    ).toEqual(["claude:loose"]);
  });
});

describe("what an agent read", () => {
  const reads = (read: number, stale: boolean): PeerStaleReads => ({
    fresh: !stale,
    reads: [
      {
        project: "booking",
        scope: "task:bkg-812",
        session: "claude:you",
        environment: "here",
        version: read,
        at: "2026-10-10T09:00:00Z",
      },
    ],
    stale: stale
      ? [
          {
            project: "booking",
            scope: "task:bkg-812",
            readVersion: read,
            currentVersion: 7,
            at: "2026-10-10T09:00:00Z",
            updatedAt: "2026-10-10T09:30:00Z",
          },
        ]
      : [],
  });

  it("is up to date when it read the latest version", () => {
    expect(readState(reads(7, false), "task:bkg-812", 7)).toEqual({ read: 7, behind: false });
  });

  it("is behind when a newer version is there", () => {
    expect(readState(reads(6, true), "task:bkg-812", 7)).toEqual({ read: 6, behind: true });
    expect(readState(reads(6, false), "task:bkg-812", 7)).toEqual({ read: 6, behind: true });
  });

  it("knows nothing before it read", () => {
    expect(readState(null, "task:bkg-812", 7)).toEqual({ read: undefined, behind: false });
  });
});
