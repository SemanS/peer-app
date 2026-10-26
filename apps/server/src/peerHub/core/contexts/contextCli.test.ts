// @effect-diagnostics globalDate:off - broker fixtures in a temporary checkout.
import { describe, expect, it } from "@effect/vitest";

import { brokerFixture } from "../broker/testkit.ts";

describe("peer context", () => {
  it("explicit context retrieves team findings even before a shared overview exists", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      fixture.broker["views"].set("acme", {
        sessions: [],
        overlaps: [],
        at: new Date().toISOString(),
        findings: [
          {
            id: "finding-one",
            project: "app",
            text: "Failed UTC hypothesis at commit abc with test tz",
            email: "vir@acme.test",
            session: "claude:other",
            environment: "other",
            at: new Date().toISOString(),
          },
        ],
      });
      fixture.broker["syncNow"] = async () => {};
      const result = await fixture.broker["runCli"]("context", [], {
        "x-peer-session": "claude:one",
      });
      expect(result).toContain("<team-findings>");
      expect(result).toContain("Failed UTC hypothesis");
      expect(result).toContain("finding-one");
    } finally {
      await fixture.dispose();
    }
  });
  it("keeps pending findings visible after a later unrelated context edit and hides only explicit decisions", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      fixture.broker["syncNow"] = async () => {};
      const pending = {
        id: "pending",
        project: "app",
        text: "Boundary hypothesis",
        email: "vir@acme.test",
        session: "claude:other",
        environment: "other",
        at: "2026-01-01T00:00:00Z",
      };
      fixture.broker["views"].set("acme", {
        sessions: [],
        overlaps: [],
        at: "2026-02-01T00:00:00Z",
        findings: [
          pending,
          {
            ...pending,
            id: "dismissed",
            text: "Disproved report",
            decision: {
              status: "dismissed",
              reason: "test disproved",
              actor: "ana@acme.test",
              contextScope: "project",
              contextVersion: 2,
              at: "2026-02-01T00:00:00Z",
            },
          },
        ],
      });
      const session = fixture.broker["sessions"].get("claude:one")!;
      const result = await fixture.broker["requestedFindings"](
        session,
        "project",
        Date.parse("2026-02-01T00:00:00Z"),
      );
      expect(result).toContain("Boundary hypothesis");
      expect(result).not.toContain("Disproved report");
    } finally {
      await fixture.dispose();
    }
  });
  it("pages pending findings through the explicit context command", async () => {
    const cursors: Array<string | undefined> = [];
    const fixture = await brokerFixture(() => ({
      pendingFindings: async (_workspace, _project, scope, cursor) => {
        expect(scope).toBe("project");
        cursors.push(cursor);
        return {
          findings: [
            {
              id: "next-finding",
              project: "app",
              text: "Later report",
              email: "ana@acme.test",
              session: "claude:other",
              environment: "other",
              at: "2026-02-01T00:00:00Z",
            },
          ],
          omittedCount: 0,
        };
      },
    }));
    try {
      await fixture.register("one");
      const result = await fixture.broker["runCli"]("context", ["findings", "previous-id"], {
        "x-peer-session": "claude:one",
      });
      expect(cursors).toEqual(["previous-id"]);
      expect(result).toContain("Later report");
    } finally {
      await fixture.dispose();
    }
  });
});

describe("exact shared-context reads", () => {
  it("notifies about new versions without advancing the version actually read", async () => {
    const initial = {
      project: "app",
      scope: "task:other",
      version: 1,
      text: "# Contract\nOpen includes blocked.",
      updatedAt: new Date().toISOString(),
    };
    let current = initial;
    const receipts: number[] = [];
    const fixture = await brokerFixture(() => ({
      readContext: async () => current,
      contextRead: async (_workspace, project, scope, session, version) => {
        receipts.push(version);
        return { project, scope, session, version, environment: "test", at: initial.updatedAt };
      },
    }));
    try {
      await fixture.register("reader");
      fixture.broker["syncNow"] = async () => {};
      const session = fixture.broker["sessions"].get("claude:reader")!;
      await fixture.broker["contextCli"](session, initial.scope, undefined);
      current = { ...initial, version: 2, text: "# Contract\nOpen excludes blocked." };
      await fixture.broker["mirror"]("acme", current);
      session.read.get(initial.scope)!.toldAt = 0;
      expect(fixture.broker["followedNews"](session)).toContain("version 2");
      expect(session.read.get(initial.scope)).toMatchObject({ version: 1, text: initial.text });
      expect(receipts).toEqual([1]);
      session.read.get(initial.scope)!.toldAt = 0;
      expect(fixture.broker["followedNews"](session)).toBeNull();

      await fixture.broker["contextCli"](session, initial.scope, undefined);
      expect(session.read.get(initial.scope)).toMatchObject({ version: 2, text: current.text });
      expect(receipts).toEqual([1, 2]);
      // Even a format-only new version needs a new exact receipt before handoff.
      await fixture.broker["mirror"]("acme", { ...current, version: 3, text: `${current.text}\n` });
      session.read.get(initial.scope)!.toldAt = 0;
      expect(fixture.broker["followedNews"](session)).toContain("version 3");
      expect(session.read.get(initial.scope)?.version).toBe(2);
    } finally {
      await fixture.dispose();
    }
  });

  it("returns the exact recorded text while a newer mirror arrives", async () => {
    const recording = Promise.withResolvers<void>();
    const confirm = Promise.withResolvers<void>();
    const initial = {
      project: "app",
      scope: "task:other",
      version: 1,
      text: "# Contract\nUse local date.",
      updatedAt: new Date().toISOString(),
    };
    let recorded = 0;
    const fixture = await brokerFixture(() => ({
      readContext: async () => initial,
      contextRead: async (_workspace, project, scope, session, version) => {
        recorded = version;
        recording.resolve();
        await confirm.promise;
        return { project, scope, session, version, environment: "test", at: initial.updatedAt };
      },
    }));
    try {
      await fixture.register("reader");
      await fixture.broker["mirror"]("acme", initial);
      const session = fixture.broker["sessions"].get("claude:reader")!;
      const pending = fixture.broker["contextCli"](session, "task:other", undefined);
      await recording.promise;
      await fixture.broker["mirror"]("acme", {
        ...initial,
        version: 2,
        text: "# Contract\nUse UTC date.",
      });
      confirm.resolve();
      const text = await pending;
      expect(recorded).toBe(1);
      expect(text).toContain("version 1");
      expect(text).toContain("Use local date.");
      expect(text).not.toContain("Use UTC date.");
      expect(session.read.get("task:other")).toMatchObject({ version: 1, text: initial.text });
    } finally {
      confirm.resolve();
      await fixture.dispose();
    }
  });
  it("reads canonical hub text instead of attributing a pending local edit to an old version", async () => {
    const initial = {
      project: "app",
      scope: "project",
      version: 1,
      text: "# Contract\nCommitted shared decision.",
      updatedAt: new Date().toISOString(),
    };
    const fixture = await brokerFixture(() => ({ readContext: async () => initial }));
    try {
      await fixture.register("keeper");
      const mirror = await fixture.broker["mirror"]("acme", initial);
      mirror.text = "# Contract\nPending uncommitted decision.";
      mirror.unsent = true;
      const session = fixture.broker["sessions"].get("claude:keeper")!;
      const text = await fixture.broker["contextCli"](session, "project", undefined);
      expect(text).toContain("Committed shared decision.");
      expect(text).not.toContain("Pending uncommitted decision.");
      expect(mirror.unsent).toBe(true);
      expect(mirror.text).toContain("Pending uncommitted decision.");
    } finally {
      await fixture.dispose();
    }
  });
});
