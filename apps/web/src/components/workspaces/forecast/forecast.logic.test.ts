import { describe, expect, it } from "vite-plus/test";
import type { PeerForecast } from "@t3tools/contracts";
import {
  forecastSections,
  forecastSettings,
  createForecastTaskSelector,
} from "./forecast.logic.ts";

const value: PeerForecast = {
  state: "on",
  git: "2.50.1",
  teammates: true,
  tracked: 3,
  skipped: 2,
  notOnOrigin: 1,
  paused: [],
  pairs: [
    {
      workspace: "acme",
      project: "pay",
      repository: "api",
      a: { branch: "feature/a", task: "a", email: "a@test", title: "A", where: "here" },
      b: { branch: "feature/b", task: "b", email: "b@test", title: "B", where: "origin" },
      files: ["pay.ts"],
      more: 2,
      checkedAt: "2026-10-09T12:00:00Z",
    },
  ],
};
const now = Date.parse("2026-10-09T12:30:00Z");
describe("forecast Work panel and Settings", () => {
  it("groups only several projects, attributes one prediction to both tasks and retains an unrelated badge identity", () => {
    expect(forecastSections(value)[0]?.project).toBeNull();
    const select = createForecastTaskSelector(),
      first = select(value),
      next = { ...value, pairs: [...value.pairs, { ...value.pairs[0]!, project: "web" }] };
    expect(forecastSections(next).map((section) => section.project)).toEqual([
      "acme/pay",
      "acme/web",
    ]);
    expect(first.get("acme/pay/a")?.lines).toEqual(["feature/a ↔ feature/b: pay.ts and 2 more"]);
    expect(first.get("acme/pay/b")?.count).toBe(1);
    expect(select(next).get("acme/pay/a")).toBe(first.get("acme/pay/a"));
    expect(forecastSections({ ...value, state: "off" })).toEqual([]);
  });
  it("makes every unsupported state, owner setting, fetch failure and resource limit visible without an error toast", () => {
    expect(forecastSettings(value, now)).toEqual([
      "On · Git 2.50.1.",
      "3 branches tracked.",
      "2 branches not forecast (branch limit).",
      "1 teammate branch not on origin.",
    ]);
    expect(forecastSettings({ ...value, state: "off", reason: "disabled" }, now)[0]).toBe(
      "Merge forecast is off.",
    );
    expect(forecastSettings({ ...value, state: "off", reason: "environment" }, now)[0]).toContain(
      "PEER_FORECAST=off",
    );
    for (const [reason, sentence] of [
      ["git-old", "Requires Git 2.38 or newer; found 2.37.9."],
      ["git-missing", "Git is not installed."],
      ["git-unreadable", "Could not read the Git version."],
    ] as const)
      expect(
        forecastSettings({ ...value, state: "unsupported", reason, git: "2.37.9" }, now)[0],
      ).toBe(sentence);
    expect(
      forecastSettings(
        {
          ...value,
          paused: [{ repository: "/work/api/.git", until: "2026-10-09T13:00:00Z" }],
          fetchFailedAt: "2026-10-09T12:00:00Z",
        },
        now,
      ),
    ).toContain("api is paused after slow checks and resumes in 30 min.");
    expect(forecastSettings({ ...value, fetchFailedAt: "2026-10-09T12:00:00Z" }, now)).toContain(
      "Fetching named origin branches failed 30 min ago.",
    );
    expect(forecastSettings("unavailable", now)).toEqual([
      "Merge forecast is unavailable on this environment.",
    ]);
  });
});
