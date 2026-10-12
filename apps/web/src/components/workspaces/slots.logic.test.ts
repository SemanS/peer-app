import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PeerWebPlugin, TeamSlotInput, TeamTaskSlotInput } from "./slots.types";
import {
  canWatchThreads,
  needsYouCount,
  needsYouEmptyText,
  selectPeerPlugins,
  teamPluginSignalsOf,
  teamTaskFactsOf,
} from "./slots.logic";

const REGISTRY = ["herdr", "github", "capacity", "requests", "observe", "knowledge", "memory"].map(
  (id) => ({ id }),
);

const plugin = (id: string, active = true): PeerPluginState => ({
  id,
  title: id,
  enabled: active,
  active,
  ...(active ? {} : { reason: "off" as const }),
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): PeerHubStatus => ({
  hubUrl: "https://hub.example.com",
  signedIn: true,
  email: "ana@acme.test",
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  workspaceRoot: "/home/ana/Peer",
  environmentId: "ana-laptop",
  agents: { herdr: "not-running", list: [] },
  github: { cli: false, account: null, signIn: null, error: null },
  coordination: {
    enabled: true,
    policy: "coordinate",
    claudeHooks: false,
    logPath: "/home/ana/coordination.jsonl",
    sessions: [],
    overlaps: [],
    findings: [],
    contexts: [],
    candidates: [],
  },
  sharedThreads: [],
  syncing: false,
  lastSyncAt: null,
  error: null,
  ...(plugins === undefined ? {} : { plugins }),
});

const ids = (selected: ReadonlyArray<{ readonly id: string }>) => selected.map((p) => p.id);

describe("selectPeerPlugins", () => {
  it("selects only the plugins that are active, in registry order", () => {
    const listed = status([
      plugin("knowledge"),
      plugin("observe", false),
      plugin("requests"),
      plugin("herdr"),
    ]);
    expect(ids(selectPeerPlugins(REGISTRY, listed))).toEqual(["herdr", "requests", "knowledge"]);
  });

  it("selects the features that existed before plugins when the status lists none", () => {
    const legacy = ["herdr", "github", "capacity", "requests", "observe", "knowledge"];
    expect(ids(selectPeerPlugins(REGISTRY, status()))).toEqual(legacy);
    expect(ids(selectPeerPlugins(REGISTRY, status([])))).toEqual(legacy);
  });

  it("ignores a plugin the registry does not know", () => {
    expect(
      ids(selectPeerPlugins(REGISTRY, status([plugin("telepathy"), plugin("requests")]))),
    ).toEqual(["requests"]);
  });

  it("selects nothing before the status has arrived", () => {
    expect(selectPeerPlugins(REGISTRY, null)).toEqual([]);
  });
});

describe("Needs you", () => {
  const requests: PeerWebPlugin = { id: "requests", needsYou: { count: () => 2 } };
  const knowledge: PeerWebPlugin = { id: "knowledge", needsYou: { count: () => 1 } };
  const herdr: PeerWebPlugin = {
    id: "herdr",
    needsYou: {
      emptyText: (_status, { running }) =>
        running === 0 ? "Nothing needs you. Agents you run in herdr show up here too." : null,
    },
  };
  const observe: PeerWebPlugin = { id: "observe" };

  it("adds what the active plugins say waits on the person", () => {
    expect(needsYouCount([observe, requests, knowledge], status())).toBe(3);
    expect(needsYouCount([observe], status())).toBe(0);
    expect(needsYouCount([], status())).toBe(0);
  });

  it("says nothing waits, in the words of the first plugin with more to say", () => {
    expect(needsYouEmptyText([observe, herdr], status(), 0)).toBe(
      "Nothing needs you. Agents you run in herdr show up here too.",
    );
    expect(needsYouEmptyText([observe, herdr], status(), 1)).toBe("Nothing needs you right now.");
    expect(needsYouEmptyText([observe], status(), 0)).toBe("Nothing needs you right now.");
    // Before the status arrives no plugin is known, so only the plain line is true.
    expect(needsYouEmptyText([], null, 0)).toBe("Nothing needs you right now.");
  });

  it("lets threads be watched only while Observe is among the active plugins", () => {
    expect(canWatchThreads([herdr, observe])).toBe(true);
    expect(canWatchThreads([herdr, requests])).toBe(false);
    expect(canWatchThreads([])).toBe(false);
  });
});

it("shows metrics only when active and keeps older environments quiet", () => {
  const registry = [...REGISTRY, { id: "metrics" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("metrics")])))).toEqual(["metrics"]);
  expect(ids(selectPeerPlugins(registry, status([plugin("metrics", false)])))).toEqual([]);
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("metrics");
});

describe("what plugins add to the Team page", () => {
  const input = { status: status(), project: {}, now: 0 } as unknown as TeamSlotInput;
  const row = {
    ...input,
    task: { id: "vl9", key: "VL9", title: "Refund fee field" },
  } as TeamTaskSlotInput;
  const plans: PeerWebPlugin = {
    id: "dependencies",
    teamTaskFacts: ({ task }) =>
      task.id === "vl9" ? { id: "plans", text: "Plans: meets VL11", tone: "knowledge" } : undefined,
    teamSignals: () => [
      { id: "meets", what: "VL9 and VL11 plan the same function", detail: "applyTax" },
    ],
  };
  const other: PeerWebPlugin = {
    id: "forecast",
    teamTaskFacts: () => ({ id: "plans", text: "Forecast: clean", tone: "neutral" }),
  };

  it("carries one fact of a plugin on the task's row, and lets two plugins use one id", () => {
    const facts = teamTaskFactsOf([plans, other], row);
    expect(facts.map(({ key, fact }) => [key, fact.text])).toEqual([
      ["dependencies/plans", "Plans: meets VL11"],
      ["forecast/plans", "Forecast: clean"],
    ]);
    // A task the plugin has nothing to say of gets no fact of it.
    expect(
      teamTaskFactsOf([plans, other], { ...row, task: { ...row.task, id: "vl7" } }).map(
        ({ key }) => key,
      ),
    ).toEqual(["forecast/plans"]);
  });

  it("lists the signals of the active plugins after one another, in the registry's order", () => {
    expect(teamPluginSignalsOf([other, plans], input).map(({ key }) => key)).toEqual([
      "dependencies/meets",
    ]);
  });

  it("shows nothing of a plugin that is off", () => {
    const registry = [plans, other];
    const active = selectPeerPlugins(
      registry,
      status([plugin("forecast"), plugin("dependencies", false)]),
    );
    expect(teamTaskFactsOf(active, row).map(({ key }) => key)).toEqual(["forecast/plans"]);
    expect(teamPluginSignalsOf(active, input)).toEqual([]);
  });
});
