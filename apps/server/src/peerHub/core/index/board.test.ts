// @effect-diagnostics globalDate:off - broker fixtures in a temporary checkout.
import { describe, expect, it } from "@effect/vitest";

import { brokerFixture } from "../broker/testkit.ts";
import type { HubCoordSession, HubCoordView } from "../hub/coordApi.ts";
import { taskNamed } from "../work/report.ts";

describe("automatic team discovery", () => {
  const other = (id: string, extra: Partial<HubCoordSession> = {}): HubCoordSession => ({
    id,
    project: "app",
    email: "bob@acme.test",
    environment: "other-laptop",
    agent: "codex",
    status: "working",
    label: "Separate blocked tasks from the open count",
    files: ["src/domain.js"],
    claims: [],
    seenAt: new Date().toISOString(),
    task: "counts",
    ...extra,
  });

  it.each(["claude", "codex"] as const)(
    "offers work to %s from an ordinary prompt and delivers changes between tool steps",
    async (agent) => {
      const fixture = await brokerFixture();
      try {
        await fixture.broker["sessionFor"](
          agent,
          { session_id: "summary", cwd: fixture.root },
          undefined,
        );
        const view: HubCoordView = {
          sessions: [other("codex:counts")],
          overlaps: [],
          at: new Date().toISOString(),
        };
        fixture.broker["views"].set("acme", view);
        const body = { session_id: "summary", cwd: fixture.root };
        const headers = { "x-peer-agent": agent };
        const first = await fixture.broker["hook"](
          {
            ...body,
            hook_event_name: "UserPromptSubmit",
            prompt: "Add a release readiness summary with open tasks and blockers.",
          },
          headers,
        );
        const packet = JSON.stringify(first);
        expect(packet).toContain("counts");
        expect(packet).toContain("Separate blocked tasks");
        expect(packet).toContain("src/domain.js");
        const step = {
          ...body,
          hook_event_name: "PostToolUse",
          tool_name: "Read",
          tool_input: { file_path: "src/domain.js" },
        };
        expect(await fixture.broker["hook"](step, headers)).toBeNull();

        const context = {
          project: "app",
          scope: "task:counts",
          version: 1,
          gist: "Task count contract",
          updatedAt: new Date().toISOString(),
        };
        fixture.broker["views"].set("acme", { ...view, contexts: [context] });
        expect(JSON.stringify(await fixture.broker["hook"](step, headers))).toContain("v1");
        fixture.broker["views"].set("acme", { ...view, contexts: [{ ...context, version: 2 }] });
        expect(JSON.stringify(await fixture.broker["hook"](step, headers))).toContain("v2");
        expect(await fixture.broker["hook"](step, headers)).toBeNull();
        expect(fixture.broker["sessions"].get(`${agent}:summary`)?.read.size).toBe(0);

        fixture.broker["views"].set("acme", {
          ...view,
          contexts: [{ ...context, version: 2 }],
          sessions: [
            ...view.sessions,
            other("claude:new", { task: "export", label: "Export release report", files: [] }),
          ],
        });
        const joined = JSON.stringify(await fixture.broker["hook"](step, headers));
        expect(joined).toContain("Export release report");
        expect(joined).not.toContain("Task count contract");
      } finally {
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "never offers %s its own task as other work, even while another agent is on it",
    async (agent) => {
      // As in the lab: the branch names KRK-1, so Peer puts the session on it at its first hook.
      const tasks = [
        { id: "krk-1", key: "KRK-1", title: "Pricing" },
        { id: "krk-2", key: "KRK-2", title: "Receipts" },
      ];
      const fixture = await brokerFixture(() => ({
        branchOf: async () => "krk-1-pricing",
        tasks: () => tasks,
        taskOf: (_workspace, _project, _keys, texts) => taskNamed(tasks, texts),
      }));
      try {
        fixture.broker["syncNow"] = async () => {};
        const teammate = other("claude:vat", {
          agent: "claude",
          task: "krk-1",
          label: "Give price() a VAT rate",
          files: ["src/pricing.ts"],
        });
        const view: HubCoordView = {
          sessions: [teammate],
          overlaps: [],
          at: new Date().toISOString(),
        };
        fixture.broker["views"].set("acme", view);
        const body = { session_id: "rename", cwd: fixture.root };
        const headers = { "x-peer-agent": agent };
        const start = await fixture.broker["hook"](
          { ...body, hook_event_name: "SessionStart", source: "startup" },
          headers,
        );
        expect(fixture.broker["sessions"].get(`${agent}:rename`)?.task).toBe("krk-1");
        expect(JSON.stringify(start)).not.toContain("Other work on this project");
        const ask = await fixture.broker["hook"](
          {
            ...body,
            hook_event_name: "UserPromptSubmit",
            prompt: "Rename price() to totalPrice() in src/pricing.ts and update every caller.",
          },
          headers,
        );
        expect(JSON.stringify(ask)).not.toContain("Give price() a VAT rate");
        const cli = { "x-peer-session": `${agent}:rename` };
        expect(await fixture.broker["runCli"]("index", [], cli)).toContain(
          "no other work on this project",
        );
        const status = await fixture.broker["runCli"]("status", [], cli);
        expect(status).toContain("Also on your task");
        expect(status).toContain("No other work on this project now.");

        // Another task is the others' work, and the next step names it alone.
        fixture.broker["views"].set("acme", {
          ...view,
          sessions: [
            teammate,
            other("codex:receipts", { task: "krk-2", label: "Receipts in euros" }),
          ],
        });
        const step = JSON.stringify(
          await fixture.broker["hook"](
            {
              ...body,
              hook_event_name: "PostToolUse",
              tool_name: "Read",
              tool_input: { file_path: "src/pricing.ts" },
            },
            headers,
          ),
        );
        expect(step).toContain("Receipts in euros");
        expect(step).not.toContain("Give price() a VAT rate");
      } finally {
        await fixture.dispose();
      }
    },
  );

  it("discovers another unassigned session in the same project without mixing projects or workspaces", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("summary");
      fixture.broker["views"].set("acme", {
        sessions: [
          other("codex:counts", { task: undefined }),
          other("codex:foreign", { project: "secret-project", label: "Foreign secret task" }),
        ],
        overlaps: [],
        at: new Date().toISOString(),
      });
      fixture.broker["views"].set("elsewhere", {
        sessions: [other("codex:outside", { label: "Other workspace secret" })],
        overlaps: [],
        at: new Date().toISOString(),
      });
      const response = await fixture.broker["hook"](
        {
          session_id: "summary",
          cwd: fixture.root,
          hook_event_name: "UserPromptSubmit",
          prompt: "Show release readiness.",
        },
        {},
      );
      expect(JSON.stringify(response)).toContain("Separate blocked tasks");
      expect(JSON.stringify(response)).not.toContain("secret");
    } finally {
      await fixture.dispose();
    }
  });

  it("lets an explicit index reach work beyond the automatic batch without recording reads", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("reader");
      fixture.broker["syncNow"] = async () => {};
      fixture.broker["views"].set("acme", {
        sessions: Array.from({ length: 35 }, (_, i) =>
          other(`codex:${i}`, { task: `task-${i}`, label: `Work ${i}` }),
        ),
        overlaps: [],
        at: new Date().toISOString(),
      });
      const headers = { "x-peer-session": "claude:reader" };
      const first = await fixture.broker["runCli"]("index", [], headers);
      expect(first).toContain("peer index 2");
      const last = await fixture.broker["runCli"]("index", ["2"], headers);
      expect(last).toContain("task-34");
      expect(last).not.toContain("task-0 —");
      await expect(fixture.broker["runCli"]("index", ["0"], headers)).rejects.toMatchObject({
        outcome: "usage",
        reason: expect.stringContaining("page"),
      });
      expect(fixture.broker["sessions"].get("claude:reader")?.read.size).toBe(0);
    } finally {
      await fixture.dispose();
    }
  });

  it.each([false, true])(
    "notifies a read dependency without an exact committed mirror (pending edit: %s) and still discovers activity",
    async (pendingEdit) => {
      const initial = {
        project: "app",
        scope: "task:counts",
        version: 1,
        text: "Contract v1",
        updatedAt: new Date().toISOString(),
        gist: "Counts",
      };
      const fixture = await brokerFixture(() => ({ readContext: async () => initial }));
      try {
        await fixture.register("reader");
        fixture.broker["syncNow"] = async () => {};
        const view: HubCoordView = {
          sessions: [other("codex:counts")],
          contexts: [initial],
          overlaps: [],
          at: initial.updatedAt,
        };
        fixture.broker["views"].set("acme", view);
        const session = fixture.broker["sessions"].get("claude:reader")!;
        await fixture.broker["contextCli"](session, initial.scope, undefined);
        const current = { ...initial, version: 2, gist: "Corrected counts" };
        fixture.broker["views"].set("acme", { ...view, contexts: [current] });
        if (pendingEdit) {
          const mirror = await fixture.broker["mirror"]("acme", {
            ...current,
            text: "Not committed\nWrong\nDiff",
          });
          mirror.unsent = true;
        }
        const notice = fixture.broker["news"](session)!;
        expect(notice).toContain("version 2");
        expect(notice).not.toContain("lines added");
        expect(notice).not.toContain("Corrected counts");
        expect(session.read.get(initial.scope)?.version).toBe(1);
        expect(fixture.broker["news"](session)).toBeNull();

        // v3's dedicated notice is throttled, but an agent joining must not disappear with it.
        fixture.broker["views"].set("acme", {
          ...view,
          contexts: [{ ...current, version: 3 }],
          sessions: [...view.sessions, other("claude:joined", { label: "Audit blockers" })],
        });
        const activity = fixture.broker["news"](session)!;
        expect(activity).toContain("Audit blockers");
        expect(activity).toContain("[v3]");
        expect(session.read.get(initial.scope)?.version).toBe(1);
        expect(fixture.broker["news"](session)).toBeNull();
      } finally {
        await fixture.dispose();
      }
    },
  );
});
