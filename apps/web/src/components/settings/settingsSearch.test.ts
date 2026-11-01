import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  makeProviderSettingsSchema,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import * as Schema from "effect/Schema";

import { peerSearchItems } from "../workspaces/settings/peerSettingsSearch.logic";
import type { PeerNavWorkspace } from "../workspaces/settings/peerSettings.logic";
import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  searchEntryPath,
  searchSettings,
  searchSettingsEntries,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  movedSettingsPath,
  SETTINGS_NAV_GROUPS,
  sourceControlHostSearchItems,
  sourceControlHostSettingsSearchId,
  type SettingsSearchItem,
} from "./settingsSearch";

vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  isSecretsFeatureEnabled: false,
}));

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
    to: "/settings/access",
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
  it("matches titles, sections, and remembered setting details", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("sharing", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    for (const query of ["fallback", "fallback agent", "fallback model"]) {
      expect(searchSettings(query)[0]).toMatchObject({
        id: "fallback-model",
        to: "/settings/threads",
        scope: "environment-defaults",
      });
    }
  });

  it("hides the Secrets page from nav and search while the secrets feature is disabled", () => {
    expect(SETTINGS_NAV_GROUPS.flatMap((group) => group.paths)).not.toContain("/settings/secrets");
    expect(searchSettings("1password").map((item) => item.to)).not.toContain("/settings/secrets");
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

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("hold to quit")).toEqual([]);
    expect(searchSettings("wsl")).toEqual([]);
    expect(searchSettings("update track")).toEqual([]);
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
      "review-guide-model",
      "review-guide-instructions",
      "source-control-writing-style",
      "t3-connect",
      "hold-webhooks-while-offline",
      "tailscale-https",
      "wsl-backend",
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "keep-threads-with-pull-requests",
      "days-before-auto-settle",
      "linked-environments",
    ]);
    expect(available.map((item) => item.id).filter((id) => gatedIds.has(id))).toEqual([]);
  });

  it("finds linked environments on a remote host without local maintenance access", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      localEnvironmentDisabled: true,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const results = (hasPeerLinkHost: boolean) =>
      searchSettings(
        "linked environments",
        filterAvailableSettingsSearchItems({ ...availability, hasPeerLinkHost }),
      );
    expect(results(false).map((item) => item.id)).not.toContain("linked-environments");
    expect(results(true)).toContainEqual(
      expect.objectContaining({
        id: "linked-environments",
        to: "/settings/connections",
        targetId: "linked-environments",
      }),
    );
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
      "keep-threads-with-pull-requests",
      "days-before-auto-settle",
    ];
    expect(searchSettings("auto-finish", available).map((item) => item.id)).toEqual(
      expect.arrayContaining(ids),
    );
    // Finished chats were called settled before: the old word still finds the rows.
    expect(searchSettings("auto-settle", available).map((item) => item.id)).toEqual(
      expect.arrayContaining(ids),
    );
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
});

describe("settings search targets", () => {
  it("requires an environment for the resolved telemetry export destination", () => {
    const result = searchSettings("OpenTelemetry export").find(
      (item) => item.id === "telemetry-export",
    )!;
    const target = getSettingsSearchTargetScope(result.targetId ?? result.id)!;
    expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "project")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "environment")).toBe(true);
  });

  it("keeps environment-wide settings out of project scopes", () => {
    const updates = getSettingsSearchTargetScope("provider-update-checks")!;
    expect(updates.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(updates.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "project")).toBe(false);
    const fallback = getSettingsSearchTargetScope("fallback-model")!;
    expect(fallback.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(fallback.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(fallback.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(fallback.scope, "project")).toBe(false);
    const streaming = getSettingsSearchTargetScope("response-streaming")!;
    expect(streaming.scope).toBe("project-defaults");
    expect(isSettingsSearchScopeAvailable(streaming.scope, "project")).toBe(true);
    for (const id of ["legacy-plan-mode", "legacy-context-window-indicator", "boring-sidebar"]) {
      expect(getSettingsSearchTargetScope(id)!.scope).toBeNull();
    }
  });
});

describe("auto-settlement search availability", () => {
  function environment(id: string, { connected = true, loaded = true } = {}) {
    return {
      environmentId: EnvironmentId.make(id),
      connection: { phase: connected ? ("connected" as const) : ("offline" as const) },
      serverConfig: loaded ? { environment: { capabilities: {} } } : null,
    };
  }

  const capable = environment("capable");
  const offline = environment("offline", { connected: false });
  const loading = environment("loading", { loaded: false });
  const environments = [capable, offline, loading];

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
      "keep-threads-with-pull-requests",
      "days-before-auto-settle",
    ]);
  });

  it.each([offline, loading])(
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

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutoSettlementSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
  });
});

describe("source control host search items", () => {
  const definition = {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("example"),
    label: "Example",
    searchKeywords: ["sample"],
    settings: makeProviderSettingsSchema({ apiToken: Schema.String }),
  };

  it("lists a host by its label, its keywords, and its settings fields", () => {
    const items = sourceControlHostSearchItems([UNKNOWN_SOURCE_CONTROL_CLIENT, definition]);
    expect(items.map((item) => item.title)).toEqual(["Example credentials"]);
    expect(searchSettings("sample apitoken", items).map((item) => item.id)).toEqual([
      sourceControlHostSettingsSearchId("example"),
    ]);
  });

  it("lists a host with credentials by its accounts, token and CLI", () => {
    const items = sourceControlHostSearchItems([
      {
        ...definition,
        credentials: {
          cliName: "ex",
          cliLabel: "Example CLI",
          loginCommand: "ex login",
          tokenEnvVar: "EX_TOKEN",
          tokenAccess: "access",
          newTokenUrl: (host) => `https://${host}/tokens`,
        },
      },
    ]);
    expect(items.map((item) => item.title)).toEqual(["Example accounts and token"]);
    expect(searchSettings("ex switch accounts", items)).toHaveLength(1);
  });

  it("finds the built-in hosts by their own words", () => {
    expect(searchSettings("codeberg").map((item) => item.id)).toContain("source-control");
    expect(searchSettings("ghes").map((item) => item.id)).toContain(
      sourceControlHostSettingsSearchId("github"),
    );
  });
});

describe("movedSettingsPath", () => {
  it("sends old links to the page their row moved to", () => {
    expect(movedSettingsPath("/settings/general", "text-generation-model")).toBe(
      "/settings/threads",
    );
    expect(movedSettingsPath("/settings/connections", "authorized-clients")).toBe(
      "/settings/access",
    );
    expect(movedSettingsPath("/settings/source-control", "worktree-branch-naming")).toBe(
      "/settings/worktrees",
    );
    expect(movedSettingsPath("/settings/appearance", "diff-color-scheme")).toBe("/settings/diffs");
    expect(movedSettingsPath("/settings/connections", "network-access")).toBe("/settings/access");
    expect(movedSettingsPath("/settings/storage", "storage-worktrees")).toBe("/settings/worktrees");
    expect(movedSettingsPath("/settings/storage", "")).toBe("/settings/maintenance");
    expect(movedSettingsPath("/settings/integrations", "devices")).toBe("/settings/devices");
    expect(movedSettingsPath("/settings/beta", "")).toBe("/settings/labs");
  });

  it("leaves current pages alone", () => {
    expect(movedSettingsPath("/settings/general", "time-format")).toBeNull();
    expect(movedSettingsPath("/settings/projects", "project-defaults")).toBeNull();
    expect(movedSettingsPath("/settings/connections", "remote-environments")).toBeNull();
    expect(movedSettingsPath("/settings/appearance", "theme")).toBeNull();
  });
});

describe("every page of the app's settings", () => {
  it("is found by searching, so no page is reachable only through the navigation", () => {
    const pages = new Set<string>(SETTINGS_SEARCH_ITEMS.map((item) => item.to));
    for (const to of Object.keys(SETTINGS_SECTION_LABELS)) {
      // Peer's front door is where signing in happens, not a settings page of its own.
      if (to === "/settings/peer" || to === "/settings/integrations" || to === "/settings/storage")
        continue;
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
  const PLUGINS = ["github", "capacity", "audit", "tool-trust"].map((id) => ({
    id,
    title: id,
    enabled: true,
    active: true,
  }));

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

  it("finds the gateway's master key by 'token'", () => {
    const titles = find("token").map(([title]) => title);
    expect(titles).toContain("Gateway master key");
  });

  it("finds each page, section and key field by the words people remember it by", () => {
    const found = (query: string, title: string) =>
      expect(
        find(query).map(([name]) => name),
        query,
      ).toContain(title);
    found("github checks", "GitHub PR checks");
    found("coordination", "Coordination policy");
    found("tool trust", "Tool trust");
    found("catalog", "Tools catalog");
    found("capacity", "Shared capacity");
    found("gateway", "Gateway");
    found("master key", "Gateway master key");
    found("pools", "Model pools");
    found("secrets", "Hub secrets");
    found("ai subscriptions", "AI subscriptions");
    found("people", "People and roles");
    found("domains", "Email domains");
    found("history", "Settings history");
    found("herdr", "Peer plugins");
    found("dns", "Email domains");
  });

  it("finds a project's pages once for each project the person is on", () => {
    expect(find("coordination policy").filter(([name]) => name === "Coordination policy")).toEqual([
      ["Coordination policy", "Projects › Booking › Coordination"],
      ["Coordination policy", "Projects › Peer Hub › Coordination"],
    ]);
    const [booking] = searchSettingsEntries("coordination policy", entries()).filter(
      (entry) => entry.title === "Coordination policy",
    );
    expect(booking).toMatchObject({
      location: { kind: "project", workspace: "acme", projectId: "booking", tab: "coordination" },
    });
  });

  it("opens a result on the part of the page it names", () => {
    const [checks] = searchSettingsEntries("github checks", entries());
    expect(checks).toMatchObject({
      location: { kind: "workspace", workspace: "acme", section: "general" },
      targetId: "workspace-github",
    });
  });

  it("does not hand a member the admin pages or their fields", () => {
    const member = entries("member");
    expect(find("github checks", member).map(([title]) => title)).not.toContain("GitHub PR checks");
    const tokens = find("token", member).map(([title]) => title);
    expect(tokens).not.toContain("Gateway master key");
    expect(find("secrets", member).map(([title]) => title)).not.toContain("Hub secrets");
    expect(find("yaml", member)).toEqual([]);
    expect(find("yaml").map(([title]) => title)).toEqual(["Workspace YAML"]);
    // What every member may read stays.
    expect(find("people", member).map(([title]) => title)).toContain("People and roles");
    expect(find("tool trust", member).map(([title]) => title)).toContain("Tool trust");
  });

  it("takes the items of a plugin that is turned off", () => {
    const off = PLUGINS.map((plugin) =>
      plugin.id === "github" ? { ...plugin, enabled: false, active: false, reason: "off" } : plugin,
    );
    const items = entries("admin", { status: { plugins: off, signedIn: true } });
    expect(find("github checks", items).map(([title]) => title)).not.toContain("GitHub PR checks");
  });

  it("leaves a plugin the Hub cannot serve yet in, since its page says so", () => {
    const waiting = PLUGINS.map((plugin) =>
      plugin.id === "github" ? { ...plugin, active: false, reason: "hub" } : plugin,
    );
    const items = entries("admin", { status: { plugins: waiting, signedIn: true } });
    expect(find("github checks", items).map(([title]) => title)).toContain("GitHub PR checks");
  });

  it("offers only This computer's pages with no workspace, and none when nobody is signed in", () => {
    const noWorkspace = peerSearchItems({ signedIn: true, workspace: null });
    expect(new Set(noWorkspace.map((entry) => entry.location.kind))).toEqual(new Set(["computer"]));
    expect(noWorkspace.map((entry) => entry.title)).toContain("Tool trust");
    expect(peerSearchItems({ signedIn: false, workspace: null })).toEqual([]);
  });

  it("shows where a connection stands on the result", () => {
    const withStatus = entries("admin", {
      statuses: { "workspace:github": "Needs setup", "me:plans": "2 detected" },
    });
    const byTitle = (title: string) =>
      searchSettingsEntries(title, withStatus).find((entry) => entry.title === title);
    expect(byTitle("GitHub PR checks")).toMatchObject({ status: "Needs setup" });
    expect(byTitle("AI subscriptions")).toMatchObject({ status: "2 detected" });
    expect(byTitle("Hub secrets")).not.toHaveProperty("status");
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
