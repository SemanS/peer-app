import { describe, expect, it } from "vite-plus/test";
import type { PeerForecast } from "@t3tools/contracts";
import {
  createForecastTaskSelector,
  forecastAvailable,
  forecastSide,
  forecastSections,
  forecastSettings,
  forecastAge,
  forecastRepositoryName,
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
    expect(
      forecastSettings({ ...snapshot, state: "off", reason: "environment" }, 0).join(),
    ).toContain("PEER_FORECAST=off");
    expect(
      forecastSettings(
        {
          ...snapshot,
          state: "unsupported",
          reason: "git-old",
          git: "2.37.9",
        },
        0,
      ).join(),
    ).toContain("2.37.9");
    expect(forecastSettings(snapshot, 0).join()).toContain("2 branches not forecast");
    expect(forecastSettings(snapshot, 0).join()).toContain("not on origin");
    // jj checkouts count bookmarks; a computer with any Git checkout keeps branches.
    expect(forecastSettings(snapshot, 0, ["jj"]).join()).toContain("2 bookmarks not forecast");
    expect(forecastSettings(snapshot, 0, ["jj", "git"]).join()).toContain(
      "2 branches not forecast",
    );
  });
  it("tells Settings' times in words, names a paused repository and says one branch in the singular", () => {
    const now = Date.parse("2026-10-09T12:10:00Z");
    expect(forecastSettings({ ...snapshot, checkedAt: "2026-10-09T12:07:00Z" }, now)).toContain(
      "8 branches tracked, last checked 3 min ago.",
    );
    expect(forecastSettings({ ...snapshot, checkedAt: "2026-10-09T12:09:50Z" }, now)).toContain(
      "8 branches tracked, last checked just now.",
    );
    expect(forecastSettings({ ...snapshot, tracked: 1, skipped: 1, notOnOrigin: 1 }, now)).toEqual([
      "On.",
      "1 branch tracked.",
      "1 branch not forecast (branch limit).",
      "1 teammate branch not on origin.",
    ]);
    const lines = forecastSettings(
      {
        ...snapshot,
        paused: [{ repository: "/work/shop/.git", until: "2026-10-09T13:10:00Z" }],
        fetchFailedAt: "2026-10-09T12:05:00Z",
      },
      now,
    );
    expect(lines).toContain("shop is paused after slow checks and resumes in 60 min.");
    expect(lines).toContain("Fetching named origin branches failed 5 min ago.");
    expect(lines.join(" ")).not.toContain("2026-10-09");
    expect(forecastRepositoryName("/work/shop.git")).toBe("shop.git");
    expect(forecastRepositoryName("C:\\work\\shop\\.git\\")).toBe("shop");
  });
  it("names three files in a badge's tooltip and counts the rest", () => {
    const wide = {
      ...snapshot,
      pairs: [{ ...snapshot.pairs[0]!, files: ["1.ts", "2.ts", "3.ts", "4.ts", "5.ts"], more: 2 }],
    };
    expect(createForecastTaskSelector()(wide).get("acme/app/a")?.lines).toEqual([
      "feature/a ↔ feature/b: 1.ts, 2.ts, 3.ts and 4 more",
    ]);
  });
});
