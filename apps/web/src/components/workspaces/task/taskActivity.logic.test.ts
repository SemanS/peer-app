import type { PeerCoordEvent, PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ACTIVITY_PREVIEW, activityRows, activitySentence } from "./taskActivity.logic";

const NOW = new Date(2026, 9, 12, 14, 30).getTime();
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const status = {
  email: "slavo@acme.test",
  workspaces: [
    {
      slug: "acme",
      projects: [
        {
          project: {
            id: "orders",
            members: [
              { email: "slavo@acme.test", name: "Slavo" },
              { email: "ana@acme.test", name: "Ana" },
            ],
          },
        },
      ],
    },
  ],
  coordination: {
    sessions: [{ id: "claude:1", environment: "env-here", agent: "claude" }],
  },
} as unknown as PeerHubStatus;

function event(
  id: string,
  kind: string,
  minutesAgo: number,
  overrides: Partial<PeerCoordEvent> = {},
): PeerCoordEvent {
  return {
    id,
    kind,
    project: "orders",
    at: ago(minutesAgo * MIN),
    paths: [],
    participants: [],
    ...overrides,
  };
}

const sentence = (e: PeerCoordEvent) => activitySentence(e, status, "acme");

describe("activitySentence", () => {
  it("names the agent that did it, for the person's own and for a colleague's", () => {
    expect(
      sentence(
        event("1", "handoff", 120, {
          email: "slavo@acme.test",
          session: "claude:1",
          environment: "env-here",
          status: "review",
        }),
      ),
    ).toBe("Claude handed the task off for review");
    expect(
      sentence(
        event("2", "context-write", 40, {
          email: "ana@acme.test",
          session: "codex:9",
          version: 4,
        }),
      ),
    ).toBe("Ana’s agent updated the task context to v4");
    expect(
      sentence(event("3", "context-write", 40, { email: "slavo@acme.test", session: "gone:1" })),
    ).toBe("Your agent updated the task context");
  });

  it("names a person for what they did themselves, and an automated credential as such", () => {
    expect(
      sentence(event("1", "task-status", 300, { email: "slavo@acme.test", status: "done" })),
    ).toBe("You marked the task done");
    expect(
      sentence(
        event("2", "task-status", 300, {
          email: "ana@acme.test",
          status: "open",
          fromStatus: "review",
        }),
      ),
    ).toBe("Ana reopened the task");
    expect(
      sentence(
        event("3", "task-status", 300, {
          status: "review",
          participants: ["credential:deploy-bot"],
        }),
      ),
    ).toBe("deploy-bot (automated) moved the task to review");
  });

  it("names the pull request that merged, when the event links it", () => {
    expect(
      sentence(event("1", "pr-merged", 5, { link: "https://github.com/acme/orders/pull/42" })),
    ).toBe("Pull request #42 merged");
    expect(sentence(event("2", "pr-merged", 5))).toBe("Pull request merged");
  });

  it("falls back to the history's own label, with the files an event names", () => {
    expect(sentence(event("1", "announcement", 5))).toBe("Announcement posted");
    expect(
      sentence(event("2", "overlap", 5, { paths: ["src/a.ts", "src/b.ts", "src/c.ts"] })),
    ).toBe("Overlap detected · src/a.ts, src/b.ts and 1 more");
    expect(sentence(event("3", "claim", 5, { email: "ana@acme.test", paths: ["src/a.ts"] }))).toBe(
      "Ana claimed src/a.ts",
    );
  });
});

describe("activityRows", () => {
  const created = { by: "You", at: new Date(2026, 9, 10, 16, 20).toISOString(), area: "Orders" };
  const events = [
    event("claim-1", "claim", 1, {
      email: "slavo@acme.test",
      session: "claude:1",
      paths: ["a.ts"],
    }),
    event("ctx", "context-write", 40, { email: "ana@acme.test", session: "codex:9", version: 4 }),
    event("read", "context-read", 50, { email: "slavo@acme.test", session: "claude:1" }),
    event("hand", "handoff", 120, {
      email: "slavo@acme.test",
      session: "claude:1",
      environment: "env-here",
      status: "review",
    }),
  ];
  const rows = (all: boolean, list = events) =>
    activityRows({ events: list, status, workspace: "acme", created, now: NOW, all });

  it("shows what happened to the task, newest first, ending with its creation", () => {
    const shown = rows(false);
    expect(shown.rows.map((row) => [row.when, row.what])).toEqual([
      ["40 min", "Ana’s agent updated the task context to v4"],
      ["2 h", "Claude handed the task off for review"],
      ["10 Oct", "You created the task in Orders"],
    ]);
    expect(shown.expandable).toBe(true);
  });

  it("adds the claims and reads under all activity, and says when there is nothing more", () => {
    const all = rows(true);
    expect(all.rows.map((row) => row.id)).toEqual(["claim-1", "ctx", "read", "hand", "created"]);
    expect(
      rows(
        false,
        events.filter((e) => e.kind !== "claim" && e.kind !== "context-read"),
      ),
    ).toMatchObject({
      expandable: false,
    });
  });

  it("keeps the first five of the task's own events", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      event(`e${index}`, "task-status", index + 1, { status: "review" }),
    );
    const shown = rows(false, many);
    expect(shown.rows).toHaveLength(ACTIVITY_PREVIEW);
    expect(shown.rows[0]?.id).toBe("e0");
    expect(shown.expandable).toBe(true);
    expect(rows(true, many).rows).toHaveLength(9);
  });

  it("says a task in no area was created, without an area", () => {
    const shown = activityRows({
      events: [],
      status,
      workspace: "acme",
      created: { ...created, area: null, by: "Ana" },
      now: NOW,
      all: false,
    });
    expect(shown.rows.map((row) => row.what)).toEqual(["Ana created the task"]);
    expect(shown.expandable).toBe(false);
  });

  it("ends with the last event when the Hub has no record of the task's creation", () => {
    const shown = activityRows({
      events: [events[1]!],
      status,
      workspace: "acme",
      created: undefined,
      now: NOW,
      all: false,
    });
    expect(shown.rows.map((row) => row.id)).toEqual(["ctx"]);
    expect(shown.expandable).toBe(false);
  });

  it("does not show an event twice when the history repeats one", () => {
    const shown = rows(true, [events[1]!, events[1]!]);
    expect(shown.rows.map((row) => row.id)).toEqual(["ctx", "created"]);
  });
});
