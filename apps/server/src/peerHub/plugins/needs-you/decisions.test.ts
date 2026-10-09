import { describe, expect, it } from "@effect/vitest";
import { decisionPoints, nextWake } from "./decisions.ts";
import { emptyStatus, richStatus, NOW, SINCE } from "./testkit.ts";

describe("local alert decision points", () => {
  it("publishes only the four alertable kinds in urgency order with fixed headlines", () => {
    const status = richStatus();
    const points = decisionPoints(
      status,
      [
        {
          session: "claude:s",
          since: SINCE,
          scopes: [{ scope: "PRIVATE_SCOPE", readVersion: 1, currentVersion: null }],
        },
      ],
      NOW,
    );
    expect(points.map((p) => [p.kind, p.phase, p.title])).toEqual([
      ["agent", "waiting_for_input", "Agent work"],
      ["request", "waiting_for_approval", "Request: Review work"],
      ["overlap", "waiting_for_approval", "Overlap: APP-1 · Ship work"],
      ["stale", "waiting_for_input", "Inputs changed: APP-1 · Ship work"],
    ]);
    expect(points.every((p) => p.headline.length > 0)).toBe(true);
    expect(JSON.stringify(points)).not.toMatch(/PRIVATE_|private@|me@|Private sender/);
    expect(points.find((p) => p.kind === "request")?.since).toBe(SINCE);
  });
  it("excludes other recipients, nonlocal overlaps and signed-out state", () => {
    const status = richStatus();
    expect(decisionPoints({ ...status, signedIn: false }, [], NOW)).toEqual([]);
    const filtered = {
      ...status,
      requests: status.requests?.map((v) => ({
        ...v,
        request: { ...v.request, recipient: "other@acme.test" },
      })),
      coordination: {
        ...status.coordination,
        sessions: status.coordination.sessions.map((s) => ({ ...s, local: false })),
      },
    };
    expect(decisionPoints(filtered, [], NOW).map((p) => p.kind)).toEqual(["agent"]);
    expect(
      decisionPoints(
        { ...status, coordination: { ...status.coordination, enabled: false } },
        [],
        NOW,
      ).map((p) => p.kind),
    ).toEqual(["agent", "request"]);
  });
  it("cleans titles, falls back to the project and caps urgent points at25", () => {
    const status = richStatus();
    const long = "  Agent\u0000\n\t" + "x".repeat(150);
    const points = decisionPoints(
      {
        ...status,
        requests: [],
        agents: {
          herdr: "running",
          list: Array.from({ length: 30 }, (_, n) => ({
            id: `${n}`,
            paneId: `${n}`,
            title: long,
            status: "done" as const,
          })),
        },
        coordination: {
          ...status.coordination,
          sessions: status.coordination.sessions.map((s) => ({ ...s, task: undefined })),
        },
      },
      [],
      NOW,
    );
    expect(points).toHaveLength(25);
    expect(points[0]?.title).toBe("Overlap: Application");
    const agent = points.find((p) => p.kind === "agent")!;
    expect(agent.phase).toBe("completed");
    expect([...agent.title]).toHaveLength(120);
    expect([...agent.title].every((c) => c.charCodeAt(0) >= 32)).toBe(true);
  });
  it("wakes only for future refusal, recent ask or requested overlap deadlines", () => {
    expect(nextWake(emptyStatus(), [], NOW)).toBeNull();
    expect(nextWake(emptyStatus(), [{ since: NOW }], NOW)).toBe(NOW + 120_000);
    const status = richStatus();
    const old = status.coordination.overlaps[0]!;
    const withOverlap = (extra: object) => ({
      ...status,
      coordination: {
        ...status.coordination,
        overlaps: [{ ...old, updatedAt: "2026-10-09T12:00:00Z", notes: [], ...extra }],
      },
    });
    expect(nextWake(withOverlap({}), [], NOW)).toBe(NOW + 120_000);
    expect(nextWake(withOverlap({ askedAt: "2026-10-09T12:00:00Z" }), [], NOW)).toBe(NOW + 180_000);
    expect(nextWake(withOverlap({ policy: "notify" }), [], NOW)).toBeNull();
  });
});
