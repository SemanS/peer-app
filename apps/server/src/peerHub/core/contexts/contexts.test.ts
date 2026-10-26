// @effect-diagnostics nodeBuiltinImport:off globalDate:off - working contexts in a temporary checkout.
import * as NodeFSP from "node:fs/promises";

import { describe, expect, it } from "@effect/vitest";

import { NO_PLUGINS } from "../broker/host.ts";
import { brokerFixture } from "../broker/testkit.ts";

// Peer Memory once took a keeper's working context over in memory mode; it no longer does
// (extract-peer-memory-plugin, design decision 3), so these pin the working context core keeps.
describe("a keeper's working context", () => {
  it("keeps one session for concurrent hooks, its own notes apart from the shared context it keeps, and its runtime generation", async () => {
    const uploaded: string[] = [];
    const fixture = await brokerFixture(() => ({
      keepContext: async (_workspace, project, scope, session) => ({
        project,
        scope,
        version: 1,
        text: "Shared overview only",
        updatedAt: new Date().toISOString(),
        keeper: {
          session,
          email: "ana@acme.test",
          environment: "test",
          since: new Date().toISOString(),
        },
      }),
      writeContext: async (_workspace, project, scope, _session, baseVersion, text) => {
        uploaded.push(text);
        return {
          project,
          scope,
          version: baseVersion + 1,
          text,
          updatedAt: new Date().toISOString(),
        };
      },
    }));
    try {
      const concurrent = await Promise.all([
        fixture.broker["sessionFor"](
          "claude",
          { session_id: "keeper-one", cwd: fixture.root },
          undefined,
        ),
        fixture.broker["sessionFor"](
          "claude",
          { session_id: "keeper-one", cwd: fixture.root },
          undefined,
        ),
      ]);
      const session = concurrent[0];
      expect(session).not.toBeNull();
      expect(concurrent[1]).toBe(session);
      if (session === null || session === undefined) return;
      const generation = session.runtimeGeneration;
      await fixture.broker["startedContext"](session, "startup", NO_PLUGINS);
      expect(session.keeps).toBe(true);
      expect(session.contextPath).toBe(session.ownContextPath);
      const mirror = fixture.broker["mirrorOf"](session)!;
      expect(session.contextPath).not.toBe(mirror.path);
      await NodeFSP.writeFile(
        session.ownContextPath,
        "Private analysis\n## For the team\n- Prices are kept in cents",
      );
      await fixture.broker["readTeamLines"](session);
      await fixture.broker["saveShared"](session);
      // Its own notes are not the shared context; what it marks for the team is reported.
      expect(uploaded).toEqual([]);
      expect(fixture.broker["reportFor"]("acme")[0]?.findings).toEqual([
        "Prices are kept in cents",
      ]);
      await NodeFSP.writeFile(mirror.path, "A deliberately edited shared overview");
      await fixture.broker["saveShared"](session);
      expect(uploaded).toEqual(["A deliberately edited shared overview"]);
      await fixture.broker["release"](session);
      await fixture.broker["takeUp"](session);
      expect(session.contextPath).toBe(session.ownContextPath);
      expect(await NodeFSP.readFile(session.ownContextPath, "utf8")).toContain("Private analysis");
      expect(
        (
          await fixture.broker["sessionFor"](
            "claude",
            { session_id: "keeper-one", cwd: fixture.root },
            undefined,
          )
        )?.runtimeGeneration,
      ).toBe(generation);
      expect(fixture.broker["reportFor"]("acme")[0]?.runtimeGeneration).toBe(generation);
      await fixture.broker["answerHook"]("PreCompact", session, {});
      expect(await NodeFSP.readFile(`${session.ownContextPath}.checkpoint.md`, "utf8")).toContain(
        "Private analysis",
      );
      await fixture.broker["answerHook"]("SessionEnd", session, {});
      expect(fixture.broker["sessions"].has(session.id)).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps a new session's working context in Peer's contexts directory", async () => {
    const fixture = await brokerFixture();
    try {
      const session = await fixture.broker["sessionFor"](
        "claude",
        { session_id: "legacy-one", cwd: fixture.root },
        undefined,
      );
      expect(session?.ownContextPath).toContain("/contexts/");
      expect(session?.contextPath).toBe(session?.ownContextPath);
    } finally {
      await fixture.dispose();
    }
  });
});

describe("working context retention", () => {
  it("retains private notes, checkpoints, inputs and unsent work after 60 days", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("returning");
      const session = fixture.broker.sessions.get("claude:returning")!;
      await NodeFSP.mkdir(
        session.ownContextPath.slice(0, session.ownContextPath.lastIndexOf("/")),
        { recursive: true },
      );
      const files = [
        session.ownContextPath,
        `${session.ownContextPath}.checkpoint.md`,
        session.ownContextPath.replace(/\.md$/, ".memory.json"),
        `${session.ownContextPath}.unsent`,
      ];
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      for (const file of files) {
        await NodeFSP.writeFile(
          file,
          file.endsWith(".json")
            ? JSON.stringify({ read: [["project", 2, 2, 0]] })
            : "Recovery evidence",
        );
        await NodeFSP.utimes(file, old, old);
      }
      await fixture.broker.forgetOldContexts();
      for (const file of files) expect(await NodeFSP.readFile(file, "utf8")).not.toBe("");
    } finally {
      await fixture.dispose();
    }
  });

  it("expires a known closed archive after 90 days while retaining reopened or unknown work", async () => {
    let closed = false;
    const fixture = await brokerFixture(() => ({
      taskOf: () => "task-1",
      tasks: () => [{ id: "task-1", title: "Recovery" }],
      taskDone: () => closed,
    }));
    try {
      await fixture.register("archived");
      const session = fixture.broker.sessions.get("claude:archived")!;
      const memory = session.ownContextPath.replace(/\.md$/, ".memory.json");
      await NodeFSP.mkdir(memory.slice(0, memory.lastIndexOf("/")), { recursive: true });
      await NodeFSP.writeFile(session.ownContextPath, "Private recovery notes");
      await NodeFSP.writeFile(`${session.ownContextPath}.checkpoint.md`, "Last checkpoint");
      await NodeFSP.writeFile(
        memory,
        JSON.stringify({
          inputs: {
            version: 1,
            workspace: session.workspace,
            project: session.project,
            session: session.id,
            task: "task-1",
            closedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString(),
          },
        }),
      );
      fixture.broker.sessions.delete(session.id);
      await fixture.broker.forgetOldContexts();
      expect(await NodeFSP.readFile(session.ownContextPath, "utf8")).toContain("Private");
      closed = true;
      await fixture.broker.forgetOldContexts();
      await expect(NodeFSP.stat(session.ownContextPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(NodeFSP.stat(memory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(NodeFSP.stat(`${session.ownContextPath}.checkpoint.md`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fixture.dispose();
    }
  });
});
