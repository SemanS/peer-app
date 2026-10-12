import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import { peerSearchItems } from "../workspaces/settings/peerSettingsSearch.logic";
import type { PeerNavWorkspace } from "../workspaces/settings/peerSettings.logic";
import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsOverviewVisible,
  isSettingsSearchScopeAvailable,
  searchableSetting,
  searchEntryPath,
  searchSettings,
  searchSettingsEntries,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
    searchTerms: ["long lines in code previews"],
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
    searchTerms: ["remote pairing backend"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["claude codex agents"],
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it.each(["send shortcut", "multiline", "new line"])("finds Send shortcut for %s", (query) => {
    expect(searchSettings(query).map((item) => item.id)).toContain("send-shortcut");
  });

  it("matches titles, sections, and remembered setting details", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("connections", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("glass").map((item) => item.id)).toEqual(["setting-glass-opacity"]);
    expect(searchSettings("panel animations").map((item) => item.id)).toEqual(["panel-animations"]);
    expect(searchSettings("thè\u{1ab0}mes")[0]?.id).toBe("theme");
    const localeLowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase").mockReturnValue("gıt");
    try {
      expect(searchSettings("GIT")[0]?.id).toBe("git-fetch-interval");
      expect(localeLowerCase).not.toHaveBeenCalled();
    } finally {
      localeLowerCase.mockRestore();
    }
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("keeps catalog order for multiple title matches", () => {
    expect(searchSettings("update", ITEMS).map((item) => item.id)).toEqual([
      "provider-updates",
      "automatic-updates",
    ]);
  });

  it("matches query words across fields and ranks the strongest result first", () => {
    expect(searchSettings("pairing remote", ITEMS).map((item) => item.id)).toEqual([
      "network-access",
    ]);
    expect(
      searchSettings("remote pairing")
        .slice(0, 2)
        .map((item) => item.id),
    ).toEqual(["network-access", "connections-environment"]);
  });

  it("finds settings that used to be reachable only through their section", () => {
    expect(searchSettings("pull request template")[0]?.id).toBe("follow-change-request-templates");
    expect(searchSettings("git security keys")[0]?.id).toBe("git-fetch-interval");
    expect(searchSettings("push notifications")[0]?.id).toBe("publish-agent-activity");
    expect(searchSettings("battery saver")[0]?.id).toBe("background-activity");
    expect(searchSettings("binary path")[0]?.id).toBe("providers");
    expect(searchSettings("Antigravity")[0]?.id).toBe("providers");
    expect(searchSettings("Google sign in")[0]?.id).toBe("providers");
    expect(searchSettings("authorized clients")[0]?.id).toBe("connections-environment");
    expect(searchSettings("administrative access")[0]?.id).toBe("connections-environment");
  });

  it("lists thread confirmations in panel order", () => {
    expect(searchSettings("confirmation").map((item) => item.id)).toEqual([
      "unpin-confirmation",
      "archive-confirmation",
      "delete-confirmation",
    ]);
  });

  it.each(["usage providers", "CLIProxyAPI", "CLI proxy hub", "management key"])(
    "finds usage-provider management by %s",
    (query) => {
      expect(searchSettings(query)[0]).toMatchObject({
        id: "usage-providers",
        to: "/settings/providers",
      });
    },
  );

  it("returns no results for an empty query", () => {
    expect(searchSettings("   ", ITEMS)).toEqual([]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("hold to quit")).toEqual([]);
    expect(searchSettings("wsl")).toEqual([]);
  });

  it("hides macOS-only settings on other platforms", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      expect(searchSettings("font smoothing")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("registers the WSL backend as a desktop-only setting", () => {
    expect(SETTINGS_SEARCH_ITEMS.find((item) => item.id === "wsl-backend")).toMatchObject({
      id: "wsl-backend",
      title: "WSL backend",
      to: "/settings/connections",
      desktopOnly: true,
      windowsOnly: true,
    });
  });

  it("hides settings whose controls are unavailable", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    });

    const gatedIds = new Set<string>([
      "follow-change-request-templates",
      "git-fetch-interval",
      "network-access",
      "publish-agent-activity",
      "provider-health-check-interval",
      "cursor-keychain-usage",
      "source-control-writer-model",
      "source-control-writing-style",
      "t3-connect",
      "tailscale-https",
      "wsl-backend",
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
    ]);
    expect(available.map((item) => item.id).filter((id) => gatedIds.has(id))).toEqual([]);
  });

  it("offers Cursor Keychain settings only when a macOS provider environment is available", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const itemIds = (macAvailable: boolean) =>
      filterAvailableSettingsSearchItems({
        ...availability,
        hasMacProviderSettingsEnvironment: macAvailable,
      }).map((item) => item.id);
    expect(itemIds(false)).not.toContain("cursor-keychain-usage");
    expect(itemIds(true)).toContain("cursor-keychain-usage");
  });

  it("keeps the local toggle searchable without offering hidden host publishing controls", () => {
    const availability = {
      hasCloudPublicConfig: true,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const remoteOnly = filterAvailableSettingsSearchItems({
      ...availability,
      localEnvironmentDisabled: true,
    }).map((item) => item.id);
    expect(remoteOnly).toContain("local-environment");
    expect(remoteOnly).not.toContain("t3-connect");
    expect(remoteOnly).not.toContain("publish-agent-activity");
    expect(remoteOnly).not.toContain("wsl-backend");
    // Browsers without access:write still render CloudLinkRow for their host.
    const browser = filterAvailableSettingsSearchItems(availability).map((item) => item.id);
    expect(browser).toContain("publish-agent-activity");
  });

  it("shows automatic settlement settings when the server supports them", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: true,
    });

    const ids = [
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
    ];
    expect(searchSettings("auto-finish", available).map((item) => item.id)).toEqual(ids);
    // Finished chats were called settled before: the old word still finds the rows.
    expect(searchSettings("auto-settle", available).map((item) => item.id)).toEqual(ids);
  });

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
  });

  it("ranks keybinding commands after other settings", () => {
    const ids = searchSettings("model").map((item) => item.id);
    expect(ids[0]).toBe("default-model");
    expect(ids.indexOf("keybinding-modelPicker.toggle")).toBeGreaterThan(
      ids.indexOf("text-generation-model"),
    );
  });

  it("sends commands without a default binding to the section", () => {
    expect(searchSettings("thread.stop")[0]).toMatchObject({
      id: "keybinding-thread.stop",
      targetId: "keybindings",
    });
    expect(searchSettings("sidebar.toggle")[0]?.targetId).toBeUndefined();
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves anchor props to panels from the catalog", () => {
    expect(searchableSetting("word-wrap")).toEqual({ id: "word-wrap", title: "Word wrap" });
    expect(searchableSetting("archive")).toEqual({ id: "archive", title: "Archived threads" });
  });

  it("routes appearance settings to their current section", () => {
    expect(searchSettings("theme")[0]).toMatchObject({
      id: "theme",
      to: "/settings/appearance",
    });
    expect(searchSettings("word wrap")[0]).toMatchObject({
      id: "word-wrap",
      to: "/settings/appearance",
    });
    expect(searchSettings("composer context")[0]).toMatchObject({
      id: "composer-context",
      to: "/settings/appearance",
    });
    expect(searchSettings("environment identification")[0]).toMatchObject({
      id: "environment-identification",
      to: "/settings/appearance",
      targetId: "appearance-interface",
    });
  });

  it("routes conditional window capture settings to the stable toggle row", () => {
    const targets = [
      "capture accessibility data",
      "capture shortcut",
      "capture sound",
      "capture flash",
      "capture animations",
    ].map((query) => {
      const match = searchSettings(query)[0];
      return [match?.id, match?.targetId];
    });

    expect(targets).toEqual([
      ["snap-shot-accessibility", "snap-shot-enabled"],
      ["snap-shot-shortcut", "snap-shot-enabled"],
      ["snap-shot-sound", "snap-shot-enabled"],
      ["snap-shot-flash", "snap-shot-enabled"],
      ["snap-shot-animations", "snap-shot-enabled"],
    ]);
  });

  it("routes browser recording quality to integrations", () => {
    const result = searchSettings("recording frame rate")[0];
    expect(result).toMatchObject({
      id: "browser-recording-frame-rate",
      to: "/settings/integrations",
    });
    expect(result).not.toHaveProperty("targetId");
  });

  it("routes where links open to integrations", () => {
    expect(searchSettings("open links in")[0]).toMatchObject({
      id: "browser-link-target",
      to: "/settings/integrations",
    });
    expect(searchSettings("external links")[0]).toMatchObject({ id: "browser-link-target" });
  });

  it("finds the default browser profile action in the profiles list", () => {
    expect(searchSettings("default profile")[0]).toMatchObject({
      id: "browser-default-profile",
      to: "/settings/integrations",
      targetId: "browser-profiles",
    });
  });

  it.each([
    ["default model", "default-model", "/settings/general"],
    ["new threads", "new-threads", "/settings/general"],
    ["agent browser access", "agent-browser-access", "/settings/integrations"],
    ["automatically pull", "automatic-pull", "/settings/source-control"],
    ["actions", "project-actions", "/settings/projects"],
    ["project overview", "project-overview", "/settings/projects"],
  ])("routes %s to its owning category", (query, id, to) => {
    expect(searchSettings(query)[0]).toMatchObject({ id, to });
  });

  it("keeps environment settings discoverable without a primary environment", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: true,
    });
    expect(searchSettings("writing style", available)[0]?.id).toBe("source-control-writing-style");
    expect(searchSettings("auto-settle", available)).toHaveLength(3);
  });
});

describe("settings search targets", () => {
  it.each([
    "auto-settle-inactive-threads",
    "auto-settle-merged-threads",
    "days-before-auto-settle",
  ])("retains the capability requirement for %s", (targetId) => {
    expect(getSettingsSearchTargetScope(targetId)).toMatchObject({
      scope: "project-defaults",
      requiresThreadAutoSettlement: true,
    });
  });

  it("treats device-local rows as reachable from every selection", () => {
    const setting = getSettingsSearchTargetScope("time-format")!;
    expect(setting).toEqual({ title: "Time format", scope: null });
    expect(isSettingsSearchScopeAvailable(setting.scope, "project")).toBe(true);
    expect(isSettingsSearchScopeAvailable(setting.scope, "all")).toBe(true);
    expect(getSettingsSearchTargetScope("appearance")).toMatchObject({ scope: null });
    expect(getSettingsSearchTargetScope("missing-setting")).toBeNull();
  });

  it.each(["all", "environment", "project", "checkout"] as const)(
    "makes browser access editable at the %s scope",
    (kind) => {
      const setting = getSettingsSearchTargetScope("agent-browser-access")!;
      expect(isSettingsSearchScopeAvailable(setting.scope, kind)).toBe(true);
      expect(isSettingsSearchScopeAvailable(setting.scope, "unavailable")).toBe(false);
    },
  );

  it("lets project-scopable rows resolve at every server-backed scope", () => {
    const model = getSettingsSearchTargetScope("text-generation-model")!;
    expect(isSettingsSearchScopeAvailable(model.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(model.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(model.scope, "project")).toBe(true);
  });

  it("reaches source control discovery and git fetch interval from the default scope", () => {
    for (const id of ["source-control", "git-fetch-interval"]) {
      const item = getSettingsSearchTargetScope(id)!;
      expect(isSettingsSearchScopeAvailable(item.scope, "all")).toBe(true);
      expect(isSettingsSearchScopeAvailable(item.scope, "environment")).toBe(true);
      expect(isSettingsSearchScopeAvailable(item.scope, "project")).toBe(false);
    }
  });

  it("keeps environment-wide settings out of project scopes", () => {
    const updates = getSettingsSearchTargetScope("provider-update-checks")!;
    expect(updates.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(updates.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "project")).toBe(false);
    const streaming = getSettingsSearchTargetScope("response-streaming")!;
    expect(streaming.scope).toBe("project-defaults");
    expect(isSettingsSearchScopeAvailable(streaming.scope, "project")).toBe(true);
    for (const id of ["legacy-plan-mode", "legacy-context-window-indicator", "legacy-sidebar"]) {
      expect(getSettingsSearchTargetScope(id)!.scope).toBeNull();
    }
  });
});

describe("auto-settlement search availability", () => {
  function environment(id: string, { connected = true, loaded = true, supported = true } = {}) {
    return {
      environmentId: EnvironmentId.make(id),
      connection: { phase: connected ? ("connected" as const) : ("offline" as const) },
      serverConfig: loaded
        ? { environment: { capabilities: { threadAutoSettlement: supported } } }
        : null,
    };
  }

  const capable = environment("capable");
  const unsupported = environment("unsupported", { supported: false });
  const offline = environment("offline", { connected: false });
  const loading = environment("loading", { loaded: false });
  const environments = [capable, unsupported, offline, loading];

  it("keeps results discoverable when one connected environment supports them", () => {
    const availability = getThreadAutoSettlementSearchAvailability(environments);
    expect(availability.eligibleEnvironmentIds).toEqual([capable.environmentId]);
    const items = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: availability.eligibleEnvironmentIds.length > 0,
    });
    expect(searchSettings("auto-settle", items).map((item) => item.id)).toEqual([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
    ]);
  });

  it("offers only capable environments when an aggregate has mixed capabilities", () => {
    expect(
      getThreadAutoSettlementSearchAvailability(environments, {
        kind: "all",
        environmentIds: environments.map((entry) => entry.environmentId),
      }),
    ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
  });

  it("allows a capable named environment regardless of other environments' capabilities", () => {
    expect(
      getThreadAutoSettlementSearchAvailability(environments, {
        kind: "environment",
        environmentIds: [capable.environmentId],
      }).isTargetAvailable,
    ).toBe(true);
  });

  it.each([unsupported, offline, loading])(
    "does not render the target on $environmentId or silently fall back",
    (selected) => {
      expect(
        getThreadAutoSettlementSearchAvailability(environments, {
          kind: "environment",
          environmentIds: [selected.environmentId],
        }),
      ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
    },
  );

  it("offers a capable environment instead of a dead target at an unavailable scope", () => {
    expect(
      getThreadAutoSettlementSearchAvailability(environments, {
        kind: "unavailable",
        environmentIds: [capable.environmentId],
      }),
    ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
  });

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutoSettlementSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
  });

  it("offers no unavailable environments when none can render the setting", () => {
    const selected = [unsupported, offline, loading];
    expect(
      getThreadAutoSettlementSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }),
    ).toEqual({ eligibleEnvironmentIds: [], isTargetAvailable: false });
    expect(getThreadAutoSettlementSearchAvailability([]).eligibleEnvironmentIds).toEqual([]);
  });
});

describe("settings sidebar scope", () => {
  it("shows Overview only for project and checkout targets", () => {
    expect(isSettingsOverviewVisible({})).toBe(false);
    expect(isSettingsOverviewVisible({ machine: "remote" })).toBe(false);
    expect(isSettingsOverviewVisible({ project: "project" })).toBe(true);
    expect(isSettingsOverviewVisible({ project: "project", checkout: "checkout" })).toBe(true);
  });
});

describe("every page of the app's settings", () => {
  it("is found by searching, so no page is reachable only through the navigation", () => {
    const pages = new Set<string>(SETTINGS_SEARCH_ITEMS.map((item) => item.to));
    for (const to of Object.keys(SETTINGS_SECTION_LABELS)) {
      // Peer's front door is where signing in happens, not a settings page of its own.
      if (to === "/settings/peer") continue;
      expect(pages.has(to), to).toBe(true);
    }
  });

  it("says where each result lives: this computer, the app, or the Overview", () => {
    expect(searchEntryPath(searchSettings("usage providers")[0]!)).toBe(
      "This computer › Providers",
    );
    expect(searchEntryPath(searchSettings("scheduled")[0]!)).toBe(
      "This computer › Scheduled tasks",
    );
    expect(searchEntryPath(searchSettings("color scheme")[0]!)).toBe("App › Appearance");
    expect(searchEntryPath(searchSettings("overview")[0]!)).toBe("Overview");
  });
});

describe("searching Peer's pages", () => {
  const PLUGINS = [
    "slack",
    "webhooks",
    "github",
    "capacity",
    "audit",
    "tool-trust",
    "needs-you",
    "metrics",
  ].map((id) => ({ id, title: id, enabled: true, active: true }));

  const acme = (role: PeerNavWorkspace["role"]): PeerNavWorkspace => ({
    slug: "acme",
    name: "Acme",
    role,
    projects: [
      { project: { id: "booking", name: "Booking", role: "lead" } },
      { project: { id: "peer-hub", name: "Peer Hub", role: "member" } },
    ],
  });

  const entries = (
    role: PeerNavWorkspace["role"] = "admin",
    context: Partial<Parameters<typeof peerSearchItems>[0]> = {},
  ) =>
    peerSearchItems({
      signedIn: true,
      workspace: acme(role),
      status: { plugins: PLUGINS, signedIn: true },
      ...context,
    });

  const find = (query: string, list = entries()) =>
    searchSettingsEntries(query, list).map((entry) => [entry.title, searchEntryPath(entry)]);

  it("finds the six places Slack lives, each with where it is", () => {
    expect(find("slack")).toEqual(
      expect.arrayContaining([
        ["Slack conversations", "Workspace › Integrations"],
        ["Bot token", "Workspace › Integrations › Slack"],
        ["Signing secret", "Workspace › Integrations › Slack"],
        ["Slack account", "Me › Slack"],
        ["Slack plugin", "This computer › Coordination & plugins"],
        ["Webhooks", "Workspace › Integrations"],
      ]),
    );
    expect(find("slack")).toHaveLength(6);
  });

  it("finds the bot token and the gateway's master key by 'token'", () => {
    const titles = find("token").map(([title]) => title);
    expect(titles).toContain("Bot token");
    expect(titles).toContain("Gateway master key");
    // The title that says it leads.
    expect(titles[0]).toBe("Bot token");
  });

  it("finds each page, section and key field by the words people remember it by", () => {
    const found = (query: string, title: string) =>
      expect(
        find(query).map(([name]) => name),
        query,
      ).toContain(title);
    found("signing secret", "Signing secret");
    found("webhook", "Webhooks");
    found("signing key", "Webhook signing key");
    found("github checks", "GitHub PR checks");
    found("coordination", "Coordination policy");
    found("path rules", "Path rules");
    found("test a path", "Test a path");
    found("tool trust", "Tool trust");
    found("catalog", "Tools catalog");
    found("capacity", "Shared capacity");
    found("gateway", "Gateway");
    found("master key", "Gateway master key");
    found("pools", "Model pools");
    found("secrets", "Hub secrets");
    found("ai subscriptions", "AI subscriptions");
    found("phone alerts", "Phone alerts");
    found("people", "People and roles");
    found("domains", "Email domains");
    found("history", "Settings history");
    found("herdr", "Peer plugins");
    found("manifest", "Slack conversations");
    found("dns", "Email domains");
  });

  it("finds a project's pages once for each project the person is on", () => {
    expect(find("path rules")).toEqual([
      ["Path rules", "Projects › Booking › Coordination"],
      ["Path rules", "Projects › Peer Hub › Coordination"],
    ]);
    const [booking] = searchSettingsEntries("path rules", entries());
    expect(booking).toMatchObject({
      location: { kind: "project", workspace: "acme", projectId: "booking", tab: "coordination" },
    });
  });

  it("opens a result on the part of the page it names", () => {
    const [token] = searchSettingsEntries("bot token", entries());
    expect(token).toMatchObject({
      location: { kind: "workspace", workspace: "acme", section: "integrations" },
      targetId: "integrations-slack",
    });
  });

  it("does not hand a member the admin pages or their fields", () => {
    const member = entries("member");
    const titles = find("slack", member).map(([title]) => title);
    expect(titles).toEqual(expect.arrayContaining(["Slack account", "Slack plugin"]));
    for (const admin of ["Slack conversations", "Bot token", "Signing secret", "Webhooks"]) {
      expect(titles).not.toContain(admin);
    }
    const tokens = find("token", member).map(([title]) => title);
    expect(tokens).not.toContain("Bot token");
    expect(tokens).not.toContain("Gateway master key");
    expect(find("secrets", member).map(([title]) => title)).not.toContain("Hub secrets");
    expect(find("yaml", member)).toEqual([]);
    expect(find("yaml").map(([title]) => title)).toEqual(["Workspace YAML"]);
    // What every member may read stays.
    expect(find("people", member).map(([title]) => title)).toContain("People and roles");
    expect(find("tool trust", member).map(([title]) => title)).toContain("Tool trust");
  });

  it("takes the items of a plugin that is turned off, and keeps the plugin's own to turn it back on", () => {
    const off = PLUGINS.map((plugin) =>
      plugin.id === "slack" ? { ...plugin, enabled: false, active: false, reason: "off" } : plugin,
    );
    const items = entries("admin", { status: { plugins: off, signedIn: true } });
    expect(find("slack", items).map(([title]) => title)).toEqual(["Slack plugin", "Webhooks"]);
  });

  it("leaves a plugin the Hub cannot serve yet in, since its page says so", () => {
    const waiting = PLUGINS.map((plugin) =>
      plugin.id === "slack" ? { ...plugin, active: false, reason: "hub" } : plugin,
    );
    const items = entries("admin", { status: { plugins: waiting, signedIn: true } });
    expect(find("slack", items).map(([title]) => title)).toContain("Slack conversations");
  });

  it("offers only This computer's pages with no workspace, and none when nobody is signed in", () => {
    const noWorkspace = peerSearchItems({ signedIn: true, workspace: null });
    expect(new Set(noWorkspace.map((entry) => entry.location.kind))).toEqual(new Set(["computer"]));
    expect(noWorkspace.map((entry) => entry.title)).toContain("Tool trust");
    expect(peerSearchItems({ signedIn: false, workspace: null })).toEqual([]);
  });

  it("shows where a connection stands on the result", () => {
    const withStatus = entries("admin", {
      statuses: { "workspace:slack": "Needs setup", "me:plans": "2 detected" },
    });
    const byTitle = (title: string) =>
      searchSettingsEntries(title, withStatus).find((entry) => entry.title === title);
    expect(byTitle("Slack conversations")).toMatchObject({ status: "Needs setup" });
    expect(byTitle("AI subscriptions")).toMatchObject({ status: "2 detected" });
    expect(byTitle("Webhooks")).not.toHaveProperty("status");
  });

  it("searches the app's settings and Peer's together, the app's first", () => {
    const together = searchSettingsEntries("providers", [...SETTINGS_SEARCH_ITEMS, ...entries()]);
    expect(together[0]).toMatchObject({ id: "providers", to: "/settings/providers" });
    expect(searchEntryPath(together[0]!)).toBe("This computer › Providers");
  });

  it("keeps result ids unique across projects and pages", () => {
    const ids = entries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
