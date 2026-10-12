import type { PeerHubStatus, PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chatMetaParts,
  chatMetaText,
  chatsSharingATitle,
  chatTaskIndex,
  chatTitleKey,
  createChatTaskLabeler,
  draftMetaParts,
  draftTaskLabel,
  finishedShelfNote,
  showProjectInChatMeta,
  snoozedUntilLabel,
  type ChatTaskThread,
} from "./Sidebar.chats.logic";
import { formatShortTimestamp } from "../timestampFormat";

const HERE = "env-here";

function task(id: string, title: string, key?: string): PeerTask {
  return {
    id,
    title,
    status: "open",
    createdBy: "slavo@acme.test",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...(key === undefined ? {} : { key }),
  };
}

/** The slice of a Hub status the index reads: one workspace with the Ordering demo project. */
function status(
  tasks: ReadonlyArray<PeerTask>,
  assignments: Record<string, string> = {},
): Pick<PeerHubStatus, "environmentId" | "workspaces"> {
  return {
    environmentId: HERE,
    workspaces: [
      {
        slug: "webinson",
        projects: [
          {
            project: { id: "ordering" },
            repositories: [{ id: "app", projectId: "t3-ordering" }],
            work: { areas: [], tasks, threads: [], assignments },
          },
        ],
      },
    ],
  } as unknown as Pick<PeerHubStatus, "environmentId" | "workspaces">;
}

function thread(id: string, title: string, overrides: Partial<ChatTaskThread> = {}) {
  return {
    environmentId: HERE,
    id,
    projectId: "t3-ordering",
    title,
    branch: null,
    ...overrides,
  } satisfies ChatTaskThread;
}

const TASKS = [
  task("t3", "Totals with service charge", "ORD-3"),
  task("t6", "Receipt footer", "ORD-6"),
  task("loose", "Loose ends"),
];

describe("chatMetaParts", () => {
  it("names the task, the project and the agent, in that order", () => {
    const parts = chatMetaParts({
      task: "ORD-3",
      projectName: "Ordering demo",
      agentName: "Claude",
      startedAt: null,
    });
    expect(parts.map((part) => part.kind)).toEqual(["task", "project", "agent"]);
    expect(chatMetaText(parts)).toBe("ORD-3 · Ordering demo · Claude");
  });

  it("says No task first, and leaves out what it does not know", () => {
    expect(
      chatMetaText(
        chatMetaParts({
          task: "No task",
          projectName: "Receipt printer",
          agentName: "Codex",
          startedAt: null,
        }),
      ),
    ).toBe("No task · Receipt printer · Codex");
    expect(
      chatMetaText(
        chatMetaParts({ task: null, projectName: null, agentName: "Claude", startedAt: null }),
      ),
    ).toBe("Claude");
    expect(
      chatMetaText(chatMetaParts({ task: " ", projectName: "", agentName: null, startedAt: null })),
    ).toBe("");
  });

  it("ends with when the chat started, so two chats of one title read differently", () => {
    const morning = chatMetaParts({
      task: "ORD-6",
      projectName: "Ordering demo",
      agentName: "Codex",
      startedAt: "11:40",
    });
    const afternoon = chatMetaParts({
      task: "ORD-6",
      projectName: "Ordering demo",
      agentName: "Claude",
      startedAt: "14:02",
    });
    expect(morning.at(-1)).toEqual({ kind: "started", text: "started 11:40" });
    expect(chatMetaText(afternoon)).toBe("ORD-6 · Ordering demo · Claude · started 14:02");
    expect(chatMetaText(morning)).not.toBe(chatMetaText(afternoon));
  });

  it("reads a screen reader's line with commas", () => {
    expect(
      chatMetaText(
        chatMetaParts({
          task: "ORD-6",
          projectName: null,
          agentName: "Claude",
          startedAt: "14:02",
        }),
        ", ",
      ),
    ).toBe("ORD-6, Claude, started 14:02");
  });
});

describe("draftMetaParts", () => {
  it("starts with the project, then the task and when the draft began", () => {
    expect(
      chatMetaText(
        draftMetaParts({
          projectName: "Ordering demo",
          task: "ORD-5",
          createdLabel: "10m ago",
        }),
      ),
    ).toBe("Ordering demo · ORD-5 · 10m ago");
  });

  it("writes no task in lower case, since it no longer opens the line", () => {
    expect(
      chatMetaText(
        draftMetaParts({
          projectName: "Receipt printer",
          task: "No task",
          createdLabel: "1d ago",
        }),
      ),
    ).toBe("Receipt printer · no task · 1d ago");
  });
});

describe("showProjectInChatMeta", () => {
  it("shows the project only when the list spans several", () => {
    expect(showProjectInChatMeta(["Ordering demo", "Receipt printer", "Ordering demo"])).toBe(true);
    expect(showProjectInChatMeta(["Ordering demo", "Ordering demo"])).toBe(false);
    expect(showProjectInChatMeta(["Ordering demo", null, undefined, ""])).toBe(false);
    expect(showProjectInChatMeta([])).toBe(false);
  });
});

describe("chatsSharingATitle", () => {
  it("flags every chat whose title another chat of the list carries, in any section", () => {
    const shared = chatsSharingATitle([
      { key: "working", title: "Receipt footer" },
      { key: "recent", title: "Receipt footer" },
      { key: "other", title: "Header layout fix" },
    ]);
    expect([...shared].toSorted()).toEqual(["recent", "working"]);
  });

  it("ignores case and spacing, never flags a lone title, and skips empty titles", () => {
    const shared = chatsSharingATitle([
      { key: "a", title: "  Receipt   footer " },
      { key: "b", title: "receipt footer" },
      { key: "c", title: "Receipt footer 2" },
      { key: "d", title: "  " },
      { key: "e", title: "" },
    ]);
    expect([...shared].toSorted()).toEqual(["a", "b"]);
    expect(chatsSharingATitle([])).toEqual(new Set());
    expect(chatTitleKey(" A   B ")).toBe("a b");
  });
});

describe("createChatTaskLabeler", () => {
  it("names the task a chat was placed on", () => {
    const label = createChatTaskLabeler(chatTaskIndex(status(TASKS, { "peer:c1": "t3" })));
    expect(label(thread("c1", "Anything"))).toBe("ORD-3");
  });

  it("names the one task a branch or a title names by key", () => {
    const label = createChatTaskLabeler(chatTaskIndex(status(TASKS)));
    expect(label(thread("c1", "Footer", { branch: "ord-6-receipt-footer" }))).toBe("ORD-6");
    expect(label(thread("c2", "ORD-3 service charge"))).toBe("ORD-3");
  });

  it("says No task when none or several are named", () => {
    const label = createChatTaskLabeler(chatTaskIndex(status(TASKS)));
    expect(label(thread("c1", "Printer driver spike"))).toBe("No task");
    expect(label(thread("c2", "ORD-3 and ORD-6 together"))).toBe("No task");
  });

  it("falls back to the title of a task without a key", () => {
    const label = createChatTaskLabeler(chatTaskIndex(status(TASKS, { "peer:c1": "loose" })));
    expect(label(thread("c1", "Anything"))).toBe("Loose ends");
  });

  it("knows no task for a chat outside a workspace project or on another computer", () => {
    const label = createChatTaskLabeler(chatTaskIndex(status(TASKS)));
    expect(label(thread("c1", "ORD-3", { projectId: "t3-elsewhere" }))).toBeNull();
    expect(label(thread("c2", "ORD-3", { environmentId: "env-other" }))).toBeNull();
    expect(createChatTaskLabeler(null)(thread("c3", "ORD-3"))).toBeNull();
    expect(chatTaskIndex(null)).toBeNull();
  });

  it("follows a chat that is renamed or moves to another branch", () => {
    const label = createChatTaskLabeler(chatTaskIndex(status(TASKS)));
    expect(label(thread("c1", "Footer"))).toBe("No task");
    expect(label(thread("c1", "Footer"))).toBe("No task");
    expect(label(thread("c1", "Footer", { branch: "ord-6-footer" }))).toBe("ORD-6");
    expect(label(thread("c1", "ORD-3 totals", { branch: "ord-6-footer" }))).toBe("No task");
  });
});

describe("draftTaskLabel", () => {
  const index = chatTaskIndex(status(TASKS));
  const draft = {
    environmentId: HERE,
    projectId: "t3-ordering",
    branch: null,
  };

  it("names the task the draft was started on", () => {
    expect(
      draftTaskLabel(index, {
        ...draft,
        workTask: { workspace: "webinson", projectId: "ordering", taskId: "t6" },
      }),
    ).toBe("ORD-6");
  });

  it("falls back to the task its branch names, else no task", () => {
    expect(draftTaskLabel(index, { ...draft, branch: "ord-3-totals" })).toBe("ORD-3");
    expect(draftTaskLabel(index, { ...draft, workTask: null })).toBe("No task");
    expect(
      draftTaskLabel(index, {
        ...draft,
        workTask: { workspace: "webinson", projectId: "ordering", taskId: "gone" },
      }),
    ).toBe("No task");
  });

  it("names nothing outside a workspace project", () => {
    expect(draftTaskLabel(index, { ...draft, projectId: "t3-elsewhere" })).toBeNull();
    expect(draftTaskLabel(null, draft)).toBeNull();
  });
});

describe("finishedShelfNote", () => {
  it("lists the ways a chat gets there, ending on what finishing does not do", () => {
    expect(finishedShelfNote({ afterDays: 3, onMerge: true })).toBe(
      "Chats with nothing left to do: you finished them, they were quiet for 3 days, or their PR merged. Finishing a chat never finishes its task. Archived chats are in Settings › Archived chats.",
    );
  });

  it("names only the ways that apply on this computer", () => {
    expect(finishedShelfNote({ afterDays: null, onMerge: true })).toContain(
      "you finished them or their PR merged.",
    );
    expect(finishedShelfNote({ afterDays: 1, onMerge: false })).toContain(
      "you finished them or they were quiet for 1 day.",
    );
    const manual = finishedShelfNote({ afterDays: null, onMerge: false });
    expect(manual).toContain("nothing left to do: you finished them.");
    expect(manual).toContain("never finishes its task");
    expect(manual).toContain("Archived chats are in Settings");
  });
});

describe("snoozedUntilLabel", () => {
  // Wednesday 2026-04-08 10:00 local time.
  const now = new Date(2026, 3, 8, 10, 0, 0, 0);
  const at = (day: number, hour: number) => new Date(2026, 3, day, hour, 0, 0, 0).toISOString();

  it("says the time today, tomorrow, then the weekday and the date", () => {
    expect(snoozedUntilLabel(at(8, 18), now, "locale")).toBe(
      `until ${formatShortTimestamp(at(8, 18), "locale")}`,
    );
    expect(snoozedUntilLabel(at(9, 9), now, "locale")).toBe("until tomorrow");
    expect(snoozedUntilLabel(at(13, 9), now, "locale")).toBe(
      `until ${new Date(at(13, 9)).toLocaleDateString(undefined, { weekday: "short" })}`,
    );
    expect(snoozedUntilLabel(at(20, 9), now, "locale")).toBe(
      `until ${new Date(at(20, 9)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    );
  });

  it("follows the clock preference for today and gives nothing for an unreadable time", () => {
    expect(snoozedUntilLabel(at(8, 18), now, "24-hour")).toBe("until 18:00");
    expect(snoozedUntilLabel("not a date", now, "locale")).toBe("");
  });
});
