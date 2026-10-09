import { describe, expect, it } from "vite-plus/test";
import type { PeerForecast } from "@t3tools/contracts";
import {
  createForecastTaskSelector,
  forecastAvailable,
  forecastSide,
  forecastSections,
  forecastSettings,
  forecastAge,
} from "./peerForecast.ts";
const a = {
    branch: "feature/a",
    email: "a@test",
    title: "Task A",
    task: "a",
    where: "here" as const,
  },
  b = { ...a, branch: "feature/b", email: "b@test", task: "b", where: "origin" as const };
const snapshot: PeerForecast = {
  state: "on",
  teammates: true,
  pairs: [
    {
      workspace: "acme",
      project: "app",
      repository: "api",
      a,
      b,
      files: ["pay.ts"],
      more: 1,
      checkedAt: "2026-10-09T12:00:00Z",
    },
  ],
  tracked: 8,
  skipped: 2,
  notOnOrigin: 1,
  paused: [],
};
describe("forecast presentation", () => {
  it("counts both tasks and preserves unrelated badge entries, including taskless branches", () => {
    const select = createForecastTaskSelector(),
      first = select(snapshot);
    expect(first.get("acme/app/a")?.count).toBe(1);
    expect(first.get("acme/app/b")?.count).toBe(1);
    const second = select({
      ...snapshot,
      pairs: [
        ...snapshot.pairs,
        {
          ...snapshot.pairs[0]!,
          a: { ...a, task: "other", branch: "feature/other" },
          b: { ...b, task: undefined, branch: "feature/free" },
        },
      ],
    });
    expect(second.get("acme/app/a")).toBe(first.get("acme/app/a"));
    expect(second.get("acme/app/other")?.count).toBe(1);
    expect(second.size).toBe(3);
    expect(forecastSide(a, "a@test")).toContain("you");
    expect(forecastSide(b, "a@test")).toContain("origin");
    expect(forecastAge(snapshot.pairs[0]!.checkedAt, Date.parse("2026-10-09T12:03:00Z"))).toBe(
      "3m ago",
    );
  });
  it("treats unknown methods as unavailable and hides empty/off sections without raising a command error", () => {
    expect(forecastAvailable({ error: new Error("unknown method") })).toBe("unavailable");
    expect(forecastSections("unavailable")).toEqual([]);
    expect(forecastSections({ ...snapshot, state: "off" })).toEqual([]);
    expect(forecastSections(snapshot)[0]?.project).toBeNull();
    expect(
      forecastSections({
        ...snapshot,
        pairs: [...snapshot.pairs, { ...snapshot.pairs[0]!, project: "other" }],
      }).map((s) => s.project),
    ).toEqual(["acme/app", "acme/other"]);
  });
  it("explains every state, limits and origin fetch failures", () => {
    expect(forecastSettings({ ...snapshot, state: "off", reason: "environment" }).join()).toContain(
      "PEER_FORECAST=off",
    );
    expect(
      forecastSettings({
        ...snapshot,
        state: "unsupported",
        reason: "git-old",
        git: "2.37.9",
      }).join(),
    ).toContain("2.37.9");
    expect(
      forecastSettings({
        ...snapshot,
        paused: [{ repository: "api", until: "later" }],
        fetchFailedAt: "earlier",
      }).join(),
    ).toContain("later");
    expect(forecastSettings(snapshot).join()).toContain("2 branches not forecast");
    expect(forecastSettings(snapshot).join()).toContain("not on origin");
  });
});
