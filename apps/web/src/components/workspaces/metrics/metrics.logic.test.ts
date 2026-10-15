import { expect, it } from "vite-plus/test";
import type { PeerMetricsSummary, PeerTask } from "@t3tools/contracts";
import {
  METRICS_COVERAGE,
  TEAM_ACTION_TEXT,
  contributingComputers,
  initialMetricsView,
  metricsSection,
  metricsSettingsState,
  metricsSpend,
  settledTeam,
  teamChoice,
} from "./metrics.logic";
const summary: PeerMetricsSummary = {
  workspace: "acme",
  project: "pay",
  scope: "environment",
  window: 28,
  dayEnding: "2026-10-09",
  computedAt: "2026-10-09T12:00:00Z",
  current: {
    counters: { "intents.decided.codex_hooks": 2 },
    durations: {},
    tasks: { t_000000000001: { in: 100, out: 10, cached: 5, turns: 1, partial: 0 } },
  },
  previous: { counters: { "intents.decided.codex_hooks": 1 }, durations: {}, tasks: {} },
  team: { state: "unsupported", reason: "Older Hub" },
};
it("defaults to a collapsed local 28-day section and shows definitions, unknown tasks and team reasons", () => {
  expect(initialMetricsView).toEqual({ scope: "environment", window: 28, expanded: false });
  const view = metricsSection(summary, [], true, "member");
  expect(view.team).toMatchObject({ available: false, reason: "Older Hub" });
  expect(view.taskRows[0]?.title).toBe("t_000000000001");
  expect(view.cards.find((c) => c.id === "coverage")?.definition).toMatch(/late.*twice/);
  const many = {
    ...summary,
    current: {
      ...summary.current,
      tasks: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [
          `t_${i.toString(16).padStart(12, "0")}`,
          { in: i, out: 0, cached: 0, turns: 1, partial: 0 },
        ]),
      ),
    },
  };
  expect(metricsSection(many, [] as PeerTask[], true, "member").taskRows).toHaveLength(10);
  expect(metricsSection(many, [], true, "member").otherTasks).toBe(5);
});
it("keeps spend in its billing period, including the person's share, and keeps tokens when it fails", () => {
  const usage = {
    project: "pay",
    currency: "EUR" as const,
    shared: {
      budget: 1000,
      period: "month" as const,
      spent: 200,
      members: [{ id: "ana@acme.test", name: "Ana", allocation: 100, spent: 20 }],
    },
    reported: [],
  };
  expect(metricsSpend(usage, true, false, "ana@acme.test").text).toContain(
    "your spend 20 of your 100 share EUR",
  );
  expect(metricsSpend(usage, true, false, "ana@acme.test").footnote).toMatch(
    /does not attribute.*tasks/,
  );
  expect(metricsSpend(usage, false, false, null).text).toMatch(/not active/);
  expect(metricsSpend(null, true, true, null).text).toMatch(/tokens remain/);
  expect(metricsSection(summary, [], true, "member").taskRows[0]?.in).toBe(100);
});
it("restricts admin controls and distinguishes forced, timed and off debug states", () => {
  const on = { state: "on" as const, reason: "on" },
    timed = { on: true, forced: false, until: 10, path: "/debug" };
  expect(metricsSettingsState("admin", true, on, timed)).toMatchObject({
    admin: true,
    debugState: "timed",
    debugUntil: 10,
  });
  expect(metricsSettingsState("member", true, on, timed).admin).toBe(false);
  expect(metricsSettingsState("admin", false, on, timed).admin).toBe(false);
  expect(
    metricsSettingsState("owner", true, summary.team, { ...timed, forced: true }),
  ).toMatchObject({ canEnableTeam: false, debugState: "forced" });
  expect(
    metricsSettingsState("owner", true, on, { on: false, forced: false, path: "/debug" })
      .debugState,
  ).toBe("off");
});
it("lets Team be chosen only while the team is on", () => {
  expect(teamChoice({ state: "on", reason: "on" }, "member")).toEqual({
    available: true,
    label: "Team",
    reason: null,
    action: null,
  });
  // Nothing is said before the first summary, and Team is not offered.
  expect(teamChoice(undefined, "admin")).toEqual({
    available: false,
    label: "Team",
    reason: null,
    action: null,
  });
});

it("says why Team cannot be chosen, and sends an admin to the switch and a member to an admin", () => {
  const off = { state: "off" as const, reason: "An owner or admin has not enabled team metrics." };
  expect(teamChoice(off, "admin")).toEqual({
    available: false,
    label: "Team · off",
    reason: "An owner or admin has not enabled team metrics.",
    action: "turn-on",
  });
  expect(teamChoice(off, "owner").action).toBe("turn-on");
  expect(teamChoice(off, "member").action).toBe("ask-admin");
  expect(TEAM_ACTION_TEXT).toEqual({
    "turn-on": "Turn on in Workspace › People",
    "ask-admin": "Ask an admin to turn it on.",
  });
});

it("offers no switch where the Hub cannot do team metrics or could not be reached", () => {
  for (const state of ["unsupported", "unknown"] as const) {
    expect(teamChoice({ state, reason: "why" }, "admin")).toEqual({
      available: false,
      label: "Team · unavailable",
      reason: "why",
      action: null,
    });
  }
});

it("shows a switch the person just flipped at once and reads the Hub only until Peer knows", () => {
  const off = { state: "off" as const, reason: "An owner or admin has not enabled team metrics." },
    on = { state: "on" as const, reason: "Team metrics are enabled." },
    unknown = { state: "unknown" as const, reason: "Peer Hub has not been reached yet." };
  // The summary read before the switch is still in the query while Peer already publishes the new state.
  expect(settledTeam(on, off)).toBe(on);
  expect(settledTeam(off, on)).toBe(off);
  // Until Peer has asked the Hub, the summary's reading is the better one; with neither, nothing.
  expect(settledTeam(unknown, on)).toBe(on);
  expect(settledTeam(unknown, undefined)).toBe(unknown);
  expect(settledTeam(undefined, off)).toBe(off);
  expect(settledTeam(undefined, undefined)).toBeUndefined();
});

it("counts the contributing computers in the singular too", () => {
  expect([0, 1, 2, 3].map(contributingComputers)).toEqual([
    "0 contributing computers",
    "1 contributing computer",
    "2 contributing computers",
    "3 contributing computers",
  ]);
});

it("says in Settings which agents the measurements cover and which add none", () => {
  for (const agent of [
    "Claude Code",
    "Peer Mod",
    "Codex",
    "Cursor",
    "Grok",
    "OpenCode",
    "Antigravity",
  ])
    expect(METRICS_COVERAGE).toContain(agent);
  expect(METRICS_COVERAGE).toMatch(/without model-input receipts or provider usage/);
  expect(METRICS_COVERAGE).toMatch(/overlaps and task times/);
});
