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
