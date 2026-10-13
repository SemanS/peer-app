import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EVA, statusFor, teamProject } from "./ownership/ownership.testkit";
import { projectSignals } from "./ProjectSignals";
import { PEER_WEB_PLUGINS, usePeerPlugins } from "./slots";
import { projectActionItems } from "./slots.logic";
import type { ProjectSlotProps } from "./slots.types";

const listed = (ids: ReadonlyArray<string>): Pick<PeerHubStatus, "plugins"> => ({
  plugins: ids.map((id): PeerPluginState => ({ id, title: id, enabled: true, active: true })),
});

// `usePeerPlugins` only selects and caches; it calls no React hook, so it runs outside a component.
const plugins = (ids: ReadonlyArray<string>) => usePeerPlugins(listed(ids));

describe("the web plugin registry", () => {
  it("follows the order the server lists plugins, each plugin once", () => {
    const ids = plugins(PEER_PLUGIN_IDS).map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(PEER_PLUGIN_IDS.filter((id) => ids.includes(id)));
    // Plugins with slots; ask and find have none, webhooks has its card on the Integrations page,
    // and memory stays hidden while the build excludes it.
    expect(ids).toEqual([
      "herdr",
      "github",
      "dependencies",
      "handoff",
      "capacity",
      "requests",
      "observe",
      "knowledge",
      "slack",
      "audit",
      "tool-trust",
      "mcp",
      "announcements",
      "needs-you",
      "resources",
      "recipes",
      "forecast",
      "metrics",
      "digest",
      "impact",
      "ownership",
      "plans",
      "settings",
    ]);
  });

  it("hands back the same list until a plugin turns on or off", () => {
    expect(plugins(["requests", "observe"])).toBe(plugins(["observe", "requests", "telepathy"]));
    expect(plugins(["requests"])).not.toBe(plugins(["requests", "observe"]));
  });
});

it("gates impact views for off, older and operator-disabled environments while retaining the registered settings explanation", () => {
  expect(plugins(["impact"]).map((p) => p.id)).toEqual(["impact"]);
  const registered = PEER_WEB_PLUGINS.find((p) => p.id === "impact");
  expect(registered?.alwaysSettings).toBeDefined();
  for (const reason of ["off", "hub", "PEER_IMPACT=off"]) {
    expect(
      usePeerPlugins({
        plugins: [
          { id: "impact", title: "Impact", enabled: reason !== "off", active: false, reason },
        ],
      }).map((p) => p.id),
    ).not.toContain("impact");
  }
  expect(usePeerPlugins({})).not.toContain(registered);
});

it("shows Plans only where it is active, and keeps its settings row to explain the rest", () => {
  expect(plugins(["plans"]).map((p) => p.id)).toEqual(["plans"]);
  const registered = PEER_WEB_PLUGINS.find((p) => p.id === "plans");
  // People read plans on a task's context page and its badge; nothing waits on them, so Needs you
  // gets nothing, and the settings row is the kind that renders while the plugin is inactive.
  expect(registered).toMatchObject({
    taskContext: expect.anything(),
    taskBadges: expect.anything(),
    alwaysSettings: expect.anything(),
  });
  expect(registered?.settings).toBeUndefined();
  expect(registered?.needsYou).toBeUndefined();
  for (const reason of ["off", "hub", "PEER_PLANS=off"]) {
    expect(
      usePeerPlugins({
        plugins: [
          {
            id: "plans",
            title: "Plans",
            enabled: reason !== "off",
            active: false,
            reason,
            ...(reason === "PEER_PLANS=off" ? { locked: true } : {}),
          },
        ],
      }).map((p) => p.id),
    ).not.toContain("plans");
  }
  expect(usePeerPlugins({}).map((p) => p.id)).not.toContain("plans");
});

describe("a project's More menu", () => {
  const props = (announcementsUnsupported: ReadonlyArray<string> = []): ProjectSlotProps =>
    ({
      environmentId: "env",
      status: { announcements: { unsupported: announcementsUnsupported, projects: [] } },
      project: { workspace: "acme", projectId: "app" },
      activeThread: null,
    }) as unknown as ProjectSlotProps;
  const labels = (ids: ReadonlyArray<string>, extra: ReadonlyArray<string> = []) =>
    projectActionItems(plugins([...ids]), props(extra)).map(({ action }) => action.label);

  it("gives every contribution a label, a hint and an icon, and a unique key", () => {
    const items = projectActionItems(PEER_WEB_PLUGINS, props());
    expect(items.length).toBeGreaterThan(0);
    for (const { key, action } of items) {
      expect(action.label.trim(), key).not.toBe("");
      expect(action.hint.trim(), key).not.toBe("");
      expect(action.icon, key).toBeDefined();
    }
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("lists what the active plugins add, in the registry's order", () => {
    expect(labels(["requests", "announcements"])).toEqual([
      "Request a teammate…",
      "Notify agents…",
    ]);
  });

  it("loses the item of a plugin that is off", () => {
    expect(labels(["requests"])).toEqual(["Request a teammate…"]);
    expect(labels(["announcements"])).toEqual(["Notify agents…"]);
    expect(labels(["observe"])).toEqual([]);
  });

  it("leaves out Notify agents… where the project's Hub cannot post announcements", () => {
    expect(labels(["requests", "announcements"], ["acme"])).toEqual(["Request a teammate…"]);
    expect(labels(["requests", "announcements"], ["other"])).toEqual([
      "Request a teammate…",
      "Notify agents…",
    ]);
  });
});

describe("a project's signals", () => {
  const withOwnership = (active: boolean) =>
    ({
      ...statusFor(EVA),
      plugins: [
        {
          id: "ownership",
          title: "Ownership",
          enabled: active,
          active,
          ...(active ? {} : { reason: "off" }),
        },
      ],
    }) as unknown as PeerHubStatus;
  const ids = (active: boolean) => {
    const status = withOwnership(active);
    return projectSignals(status, teamProject(EVA), usePeerPlugins(status)).map(({ id }) => id);
  };

  it("holds the Team tile after the overlaps while Ownership is active", () => {
    expect(ids(true)).toEqual(["overlaps", "team"]);
  });

  it("holds no Team tile while Ownership is off or not served", () => {
    expect(ids(false)).toEqual(["overlaps"]);
  });
});
