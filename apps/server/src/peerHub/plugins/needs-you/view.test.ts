import { describe, expect, it } from "@effect/vitest";
import { PeerHubStatus } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { needsYouView } from "./view.ts";
import { richStatus } from "./testkit.ts";

const decode = Schema.decodeUnknownSync(PeerHubStatus);

describe("phone's Needs You status view", () => {
  it("keeps the contract, task launch data and decisions, trimming the unrelated bulk", () => {
    const seed = richStatus();
    expect(() => decode(seed)).not.toThrow();
    const large = {
      ...seed,
      workspaces: seed.workspaces.map((w) => ({
        ...w,
        projects: w.projects.map((p) => ({
          ...p,
          work: {
            ...p.work,
            threads: Array.from({ length: 80 }, (_, n) => ({
              id: `peer:${n}`,
              title: "Colleague work ".repeat(100),
              email: "colleague@acme.test",
              environment: "colleague-machine",
              status: "working" as const,
              source: "peer" as const,
              seenAt: "2026-10-09T11:00:00Z",
            })),
          },
        })),
      })),
    };
    const view = needsYouView(large);
    expect(() => decode(view)).not.toThrow();
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(large).length / 4);
    expect(view.requests).toEqual(seed.requests);
    expect(view.workspaces[0]?.projects[0]?.work.tasks).toEqual(
      seed.workspaces[0]?.projects[0]?.work.tasks,
    );
    expect(view.workspaces[0]?.projects[0]?.work.threads).toEqual([]);
    expect(view.coordination.sessions[0]?.files).toEqual([]);
    expect(view.coordination.sessions[0]?.activeAt).toBeUndefined();
    expect(view.coordination.overlaps).toEqual(seed.coordination.overlaps);
  });
  it("ignores session file/activity and working/idle agent churn, but keeps decisions", () => {
    const seed = richStatus();
    const changed = {
      ...seed,
      agents: {
        ...seed.agents,
        list: [
          ...seed.agents.list,
          { id: "busy", paneId: "p", title: "Working", status: "working" as const },
        ],
      },
      coordination: {
        ...seed.coordination,
        sessions: seed.coordination.sessions.map((s) => ({
          ...s,
          files: ["different"],
          activeAt: "2026-10-09T12:00:00Z",
        })),
      },
    };
    expect(needsYouView(changed)).toEqual(needsYouView(seed));
    expect(
      needsYouView({
        ...changed,
        agents: {
          ...changed.agents,
          list: changed.agents.list.map((a) => (a.id === "busy" ? { ...a, status: "idle" } : a)),
        },
      }),
    ).toEqual(needsYouView(seed));
    expect(
      needsYouView({
        ...changed,
        agents: {
          ...changed.agents,
          list: changed.agents.list.map((a) => (a.id === "busy" ? { ...a, status: "blocked" } : a)),
        },
      }),
    ).not.toEqual(needsYouView(seed));
    expect(needsYouView({ ...seed, requests: [] })).not.toEqual(needsYouView(seed));
  });
});
