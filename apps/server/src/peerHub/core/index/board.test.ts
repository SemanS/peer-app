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
    "tells %s at its start who else is at work, and does not interrupt its steps with it",
    async (agent) => {
      const fixture = await brokerFixture();
      try {
        fixture.broker["syncNow"] = async () => {};
        const view: HubCoordView = {
          sessions: [other("codex:counts")],
          overlaps: [],
          at: new Date().toISOString(),
        };
        fixture.broker["views"].set("acme", view);
        const body = { session_id: "summary", cwd: fixture.root };
        const headers = { "x-peer-agent": agent };
        const start = JSON.stringify(
          await fixture.broker["hook"](
            { ...body, hook_event_name: "SessionStart", source: "startup" },
            headers,
          ),
        );
        expect(start).toContain("Also on this project now");
        expect(start).toContain("counts");
        expect(start).toContain("src/domain.js");
        expect(
          await fixture.broker["hook"](
            {
              ...body,
              hook_event_name: "UserPromptSubmit",
              prompt: "Add a release readiness summary with open tasks and blockers.",
            },
            headers,
          ),
        ).toBeNull();
        fixture.broker["views"].set("acme", {
          ...view,
          sessions: [
            ...view.sessions,
            other("claude:new", { task: "export", label: "Export release report", files: [] }),
          ],
        });
        expect(
          await fixture.broker["hook"](
            {
              ...body,
              hook_event_name: "PostToolUse",
              tool_name: "Read",
              tool_input: { file_path: "src/domain.js" },
            },
            headers,
          ),
        ).toBeNull();
        const index = await fixture.broker["runCli"]("index", [], {
          "x-peer-session": `${agent}:summary`,
        });
        expect(index).toContain("Export release report");
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
        expect(JSON.stringify(start)).not.toContain("Also on this project now");
        const cli = { "x-peer-session": `${agent}:rename` };
        expect(await fixture.broker["runCli"]("index", [], cli)).toContain(
          "no other work on this project",
        );
        const status = await fixture.broker["runCli"]("status", [], cli);
        expect(status).toContain("Also on your task");
        expect(status).toContain("No other work on this project now.");

        // Another task is the others' work, and the index names it alone.
        fixture.broker["views"].set("acme", {
          ...view,
          sessions: [
            teammate,
            other("codex:receipts", { task: "krk-2", label: "Receipts in euros" }),
          ],
        });
        const index = await fixture.broker["runCli"]("index", [], cli);
        expect(index).toContain("Receipts in euros");
        expect(index).not.toContain("Give price() a VAT rate");
      } finally {
        await fixture.dispose();
      }
    },
  );

  it("discovers another unassigned session in the same project without mixing projects or workspaces", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("summary");
      fixture.broker["syncNow"] = async () => {};
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
      const index = await fixture.broker["runCli"]("index", [], {
        "x-peer-session": "claude:summary",
      });
      expect(index).toContain("Separate blocked tasks");
      expect(index).not.toContain("secret");
    } finally {
      await fixture.dispose();
    }
  });

  it("lets an explicit index reach work beyond the first page", async () => {
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
    } finally {
      await fixture.dispose();
    }
  });
});
