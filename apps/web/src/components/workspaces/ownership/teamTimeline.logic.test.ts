import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import type { PeerCoordEvent, PeerOwnerCall, PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  NO_FILTER,
  filterTimeline,
  ownerCleared,
  timelineChoices,
  timelineRows,
  type TimelineRow,
} from "./teamTimeline.logic";
import {
  ANA,
  BOB,
  CYRIL,
  EVA,
  NOW,
  hubTask,
  minutesAgo,
  ownerCall,
  statusFor,
} from "./ownership.testkit";

/** A task the tracker gave no key. */
const { key: _noKey, ...unkeyed } = hubTask("vl12", { title: "No key here", area: "Menu" });

const TASKS: ReadonlyArray<PeerTask> = [
  hubTask("vl7", { title: "Receipt totals in cents", area: "Payments" }),
  hubTask("vl9", { title: "Refund fee field", area: "Payments" }),
  hubTask("vl11", { title: "Menu photos", area: "Menu" }),
  unkeyed,
];

let serial = 0;
/** An event of ordering's history, `minutes` ago. */
function event(
  kind: string,
  minutes: number,
  overrides: Partial<PeerCoordEvent> = {},
): PeerCoordEvent {
  serial += 1;
  return {
    id: `e${String(serial).padStart(3, "0")}`,
    kind,
    project: "ordering",
    at: minutesAgo(minutes),
    paths: [],
    participants: [],
    ...overrides,
  };
}

const CALLS: ReadonlyArray<PeerOwnerCall> = [
  ownerCall({
    id: "call-9",
    state: "declined",
    paths: ["src/payments/limits.ts"],
    note: "use the existing fee table",
    decidedBy: ANA,
  }),
  ownerCall({ id: "call-10", state: "expired", paths: ["src/payments/fees.ts"] }),
];

function rows(events: ReadonlyArray<PeerCoordEvent>, viewer = EVA): ReadonlyArray<TimelineRow> {
  const status = statusFor(viewer, { ownership: { calls: [...CALLS] } });
  const workspace = status.workspaces[0]!;
  const ownership = projectOwnership(status, workspace, workspace.projects[0]!.project)!;
  return timelineRows({ events, ownership, tasks: TASKS, now: NOW });
}

const said = (events: ReadonlyArray<PeerCoordEvent>) => rows(events).map((row) => row.what);

describe("who decided what, in sentences", () => {
  it("says an owner's call and what became of it, with the decider's note", () => {
    expect(
      said([
        event("owner-call", 40, {
          email: BOB,
          session: "claude:b1",
          task: "vl9",
          paths: ["src/payments/fees.ts"],
          participants: ["call:call-1", `owner:${ANA}`, "claude:b1"],
        }),
        event("owner-decision", 60, {
          email: ANA,
          task: "vl9",
          paths: ["src/payments/limits.ts"],
          participants: ["call:call-9", `owner:${ANA}`, `asker:${BOB}`, "decision:declined"],
        }),
      ]),
    ).toEqual([
      "Bob's agent asked Ana to change src/payments/fees.ts for VL9",
      "Ana declined Bob's agent's call on src/payments/limits.ts: “use the existing fee table”",
    ]);
  });

  it("says who decided for an owner who was away, and a call that was taken back or ran out", () => {
    expect(
      said([
        event("owner-decision", 50, {
          email: EVA,
          paths: ["src/payments/fees.ts"],
          participants: [
            "call:call-1",
            `owner:${ANA}`,
            `asker:${BOB}`,
            "decision:accepted",
            "on-behalf",
          ],
        }),
        event("owner-call-closed", 40, {
          email: BOB,
          paths: ["src/payments/fees.ts", "src/payments/refunds.ts", "src/payments/x.ts"],
          participants: ["call:call-2", `owner:${ANA}`, "withdrawn"],
        }),
        event("owner-call-closed", 30, {
          paths: ["src/payments/fees.ts"],
          participants: ["call:call-10", `owner:${ANA}`, "expired"],
        }),
        event("owner-call-closed", 20, {
          paths: ["src/payments/fees.ts"],
          participants: ["call:gone", `owner:${ANA}`, "expired"],
        }),
      ]),
    ).toEqual([
      "The call to Ana on src/payments/fees.ts expired",
      "Bob's agent's call to Ana on src/payments/fees.ts expired",
      "Bob withdrew a call to Ana on src/payments/fees.ts, src/payments/refunds.ts and 1 more",
      "Eva accepted Bob's agent's call on src/payments/fees.ts on Ana's behalf",
    ]);
  });

  it("says each change of an owner and why, and what a save of the owner map changed", () => {
    expect(
      said([
        event("task-owner", 90, {
          email: EVA,
          task: "vl7",
          participants: ["task:vl7", `owner:${CYRIL}`, "reason:named"],
        }),
        event("task-owner", 80, {
          email: BOB,
          task: "vl9",
          participants: ["task:vl9", `owner:${ANA}`, "reason:handover"],
        }),
        event("task-owner", 70, {
          email: BOB,
          task: "vl9",
          participants: ["task:vl9", `owner:${BOB}`, "reason:request"],
        }),
        event("task-owner", 60, {
          email: BOB,
          task: "vl11",
          participants: ["task:vl11", `owner:${BOB}`, "reason:first-agent"],
        }),
        event("owner-map", 50, {
          email: EVA,
          version: 8,
          participants: [`area:Menu=${CYRIL}`],
        }),
        event("owner-map", 45, {
          email: EVA,
          version: 8,
          participants: [`path:src/menu/**=${CYRIL}`],
        }),
        event("owner-map", 40, {
          email: EVA,
          version: 9,
          participants: ["path:src/menu/**=none", "decide:+src/menu/**", "decide:-src/payments/**"],
        }),
        event("owner-map", 30, { email: EVA, version: 10, participants: [] }),
      ]),
    ).toEqual([
      "Eva changed the owner map",
      "Eva took the owner off src/menu/** and 2 more changes",
      "Eva made Cyril the owner of src/menu/**",
      "Eva made Cyril owner of the area Menu",
      "Bob became the owner of VL11 by first agent",
      "Bob accepted a request for VL9 and became its owner",
      "Bob handed VL9 to Ana",
      "Eva made Cyril the owner of VL7",
    ]);
  });

  it("says a task given back by its owner, and one whose owner a lead cleared", () => {
    expect(
      said([
        event("task-owner", 120, {
          email: EVA,
          task: "vl11",
          participants: ["task:vl11", `owner:${EVA}`, "reason:first-agent"],
        }),
        event("task-owner", 100, {
          email: EVA,
          task: "vl11",
          participants: ["task:vl11", "owner:none", "reason:cleared"],
        }),
        event("task-owner", 90, {
          email: BOB,
          task: "vl9",
          participants: ["task:vl9", `owner:${BOB}`, "reason:first-agent"],
        }),
        event("task-owner", 80, {
          email: EVA,
          task: "vl9",
          participants: ["task:vl9", "owner:none", "reason:cleared"],
        }),
        // Nothing shows who owned it before: the history says only that the owner was cleared.
        event("task-owner", 70, {
          email: EVA,
          task: "vl7",
          participants: ["task:vl7", "owner:none", "reason:cleared"],
        }),
      ]),
    ).toEqual([
      "Eva cleared the owner of VL7",
      "Eva cleared the owner of VL9",
      "Bob became the owner of VL9 by first agent",
      "Eva gave VL11 back",
      "Eva became the owner of VL11 by first agent",
    ]);
  });

  it("says a task's moves, an agent's handoff, a merged pull request and a settled overlap", () => {
    expect(
      said([
        event("handoff", 50, { email: ANA, session: "claude:a1", task: "vl7", status: "review" }),
        event("handoff", 49, { email: ANA, session: "claude:a1", task: "vl9", status: "done" }),
        event("task-status", 48, { email: ANA, task: "vl7", status: "review", fromStatus: "open" }),
        event("task-status", 47, { email: ANA, task: "vl7", status: "done", fromStatus: "review" }),
        event("task-status", 46, { email: ANA, task: "vl7", status: "open", fromStatus: "done" }),
        event("pr-merged", 45, {
          email: ANA,
          task: "vl7",
          link: "https://github.com/acme/app/pull/41",
        }),
        event("pr-merged", 44, { email: ANA, link: "not a pull request" }),
        event("resolve", 43, { email: ANA, paths: ["src/orders/notes.ts"] }),
        event("resolve", 42, { email: ANA }),
      ]),
    ).toEqual([
      "Ana settled an overlap",
      "Ana settled the overlap on src/orders/notes.ts",
      "A pull request merged",
      "PR #41 merged for VL7",
      "Ana reopened VL7",
      "Ana marked VL7 done",
      "Ana moved VL7 to review",
      "Ana's agent marked VL9 done",
      "Ana's agent moved VL7 to review",
    ]);
  });

  it("names a task by its title where it has no key, and does not know a task the project lost", () => {
    expect(
      said([
        event("task-status", 5, { email: ANA, task: "vl12", status: "review" }),
        event("task-status", 4, { email: ANA, task: "gone", status: "review" }),
        event("owner-call", 3, {
          email: BOB,
          session: "s",
          task: "gone",
          paths: ["a.ts"],
          participants: [`owner:${ANA}`],
        }),
      ]),
    ).toEqual([
      "Bob's agent asked Ana to change a.ts",
      "Ana moved a task to review",
      "Ana moved No key here to review",
    ]);
  });
});

describe("what the timeline keeps and who is behind it", () => {
  it("keeps only what says who decided what, newest first, once each", () => {
    const first = event("task-status", 30, { email: ANA, task: "vl7", status: "review" });
    const result = rows([
      event("claim", 1, { email: BOB, paths: ["a.ts"] }),
      event("context-read", 2, { email: BOB }),
      event("note", 3, { email: BOB }),
      event("overlap", 4, { email: BOB }),
      first,
      first,
      event("task-status", 10, { email: BOB, task: "vl9", status: "review" }),
    ]);
    expect(result.map((row) => row.what)).toEqual([
      "Bob moved VL9 to review",
      "Ana moved VL7 to review",
    ]);
    expect(result.map((row) => row.when)).toEqual(["10 min", "30 min"]);
  });

  it("leaves out what is older than the 30 days the Hub keeps", () => {
    const result = rows([
      event("task-status", 30 * 24 * 60 + 5, { email: ANA, task: "vl7", status: "review" }),
      event("task-status", 29 * 24 * 60, { email: ANA, task: "vl9", status: "review" }),
    ]);
    expect(result.map((row) => row.what)).toEqual(["Ana moved VL9 to review"]);
    expect(result[0]?.when).toBe("29 days");
  });

  it("names the person behind each entry, the viewer too, and nobody for what the clock did", () => {
    const result = rows(
      [
        event("task-status", 2, { email: "EVA@acme.test", task: "vl7", status: "review" }),
        event("task-status", 3, { email: ANA, task: "vl7", status: "open", fromStatus: "review" }),
        event("owner-call-closed", 4, {
          paths: ["a.ts"],
          participants: ["call:x", `owner:${ANA}`, "expired"],
        }),
      ],
      EVA,
    );
    expect(result.map((row) => row.person)).toEqual([
      { email: EVA, name: "Eva", mine: true },
      { email: ANA, name: "Ana", mine: false },
      undefined,
    ]);
  });

  it("says that a request was accepted, and nothing of who sent it or what it said", () => {
    const [row] = rows([
      event("task-owner", 5, {
        email: BOB,
        task: "vl9",
        participants: ["task:vl9", `owner:${BOB}`, "reason:request"],
      }),
    ]);
    expect(row?.what).toBe("Bob accepted a request for VL9 and became its owner");
    // An entry is the sentence and the ids to narrow by: no title, prompt or session label.
    expect(Object.keys(row!).toSorted()).toEqual(
      ["areas", "at", "id", "person", "task", "what", "when"].toSorted(),
    );
  });
});

describe("narrowing the timeline", () => {
  const events = [
    event("owner-call", 40, {
      email: BOB,
      session: "claude:b1",
      task: "vl9",
      paths: ["src/payments/fees.ts"],
      participants: ["call:call-1", `owner:${ANA}`],
    }),
    event("owner-decision", 30, {
      email: ANA,
      task: "vl9",
      paths: ["src/payments/fees.ts"],
      participants: ["call:call-1", `owner:${ANA}`, `asker:${BOB}`, "decision:accepted"],
    }),
    event("owner-map", 20, { email: EVA, participants: [`area:Menu=${CYRIL}`] }),
    event("task-status", 10, { email: ANA, task: "vl7", status: "review" }),
    event("task-status", 5, { email: CYRIL, task: "vl11", status: "review" }),
  ];
  const all = rows(events);
  const filtered = (filter: Partial<typeof NO_FILTER>) =>
    filterTimeline(all, { ...NO_FILTER, ...filter }).map((row) => row.what);

  it("lists everything without a filter", () => {
    expect(filtered({})).toHaveLength(5);
  });

  it("lists the entries a person made, including their decision on someone else's call", () => {
    expect(filtered({ person: ANA })).toEqual([
      "Ana moved VL7 to review",
      "Ana accepted Bob's agent's call on src/payments/fees.ts",
    ]);
    expect(filtered({ person: BOB })).toEqual([
      "Bob's agent asked Ana to change src/payments/fees.ts for VL9",
    ]);
  });

  it("lists the entries of a task, and of an area through its tasks or its owner map", () => {
    expect(filtered({ task: "vl9" })).toHaveLength(2);
    expect(filtered({ area: "Payments" })).toEqual([
      "Ana moved VL7 to review",
      "Ana accepted Bob's agent's call on src/payments/fees.ts",
      "Bob's agent asked Ana to change src/payments/fees.ts for VL9",
    ]);
    expect(filtered({ area: "Menu" })).toEqual([
      "Cyril moved VL11 to review",
      "Eva made Cyril owner of the area Menu",
    ]);
  });

  it("combines the filters that are set", () => {
    expect(filtered({ area: "Payments", person: BOB })).toHaveLength(1);
    expect(filtered({ task: "vl7", person: BOB })).toEqual([]);
  });

  it("offers the project's areas, and the tasks and people that have entries", () => {
    expect(timelineChoices(all, { areas: ["Payments", "Menu"], tasks: TASKS })).toEqual({
      areas: ["Payments", "Menu"],
      tasks: [
        { id: "vl7", label: "VL7" },
        { id: "vl9", label: "VL9" },
        { id: "vl11", label: "VL11" },
      ],
      people: [
        { email: ANA, name: "Ana" },
        { email: BOB, name: "Bob" },
        { email: CYRIL, name: "Cyril" },
        { email: EVA, name: "Eva" },
      ],
    });
  });
});

describe("a task that was given back", () => {
  const status = statusFor(EVA);
  const workspace = status.workspaces[0]!;
  const ownership = projectOwnership(status, workspace, workspace.projects[0]!.project)!;
  const lines = (events: ReadonlyArray<PeerCoordEvent>, ownerless: ReadonlyArray<string>) =>
    Object.fromEntries(ownerCleared({ events, ownership, ownerless: new Set(ownerless) }));

  it("says who gave it back, or who cleared its owner, for a task with no owner now", () => {
    const events = [
      event("task-owner", 100, {
        email: EVA,
        task: "vl11",
        participants: ["task:vl11", `owner:${EVA}`, "reason:first-agent"],
      }),
      event("task-owner", 90, {
        email: EVA,
        task: "vl11",
        participants: ["task:vl11", "owner:none", "reason:cleared"],
      }),
      event("task-owner", 80, {
        email: BOB,
        task: "vl9",
        participants: ["task:vl9", `owner:${BOB}`, "reason:first-agent"],
      }),
      event("task-owner", 70, {
        email: ANA,
        task: "vl9",
        participants: ["task:vl9", "owner:none", "reason:cleared"],
      }),
    ];
    expect(lines(events, ["vl11", "vl9"])).toEqual({
      vl11: "Given back by Eva",
      vl9: "Owner cleared by Ana",
    });
  });

  it("says nothing of a task that has an owner, or whose owner changed after it was cleared", () => {
    const events = [
      event("task-owner", 90, {
        email: EVA,
        task: "vl11",
        participants: ["task:vl11", "owner:none", "reason:cleared"],
      }),
      event("task-owner", 60, {
        email: EVA,
        task: "vl11",
        participants: ["task:vl11", `owner:${CYRIL}`, "reason:named"],
      }),
    ];
    expect(lines(events, ["vl11"])).toEqual({});
    expect(lines(events.slice(0, 1), [])).toEqual({});
  });
});
