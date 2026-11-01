import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  SourceControlProviderKind,
  type PeerGitHubStatus,
  type PeerPluginState,
  type ServerProvider,
  type SourceControlDiscoveryResult,
  type SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { CHECKING, readyFact } from "./connectionFacts";
import {
  filterOverview,
  finishText,
  overviewRows,
  overviewSummary,
  toFinishLabel,
  type ComputerFacts,
  type OverviewFacts,
  type OverviewGroup,
  type PeerFacts,
  type WorkspaceFacts,
} from "./overview.logic";

const plugin = (id: string, extra: Partial<PeerPluginState> = {}): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...extra,
});

const PLUGINS = ["github", "settings"].map((id) => plugin(id));

const github = (extra: Partial<PeerGitHubStatus> = {}): PeerGitHubStatus => ({
  configured: false,
  webhookPath: "/v1/workspaces/webinson/github/webhook",
  lastPingAt: null,
  lastVerifiedAt: null,
  repositories: [],
  secret: "missing",
  ...extra,
});

const workspace = (extra: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  slug: "webinson",
  name: "Webinson",
  role: "admin",
  github: readyFact(github()),
  ...extra,
});

const peerFacts = (
  ws: WorkspaceFacts | null = workspace(),
  status: Partial<PeerFacts["status"]> = {},
): PeerFacts => ({
  status: {
    hubUrl: "https://hub.webinson.com",
    hub: { version: "0.1.0", commit: "4787348abc" },
    signedIn: true,
    email: "slavosmn@gmail.com",
    syncing: false,
    lastSyncAt: "2026-10-12T10:20:00Z",
    error: null,
    plugins: PLUGINS,
    ...status,
  },
  workspace: ws,
});

const tool = (
  kind: string,
  label: string,
  extra: Partial<SourceControlProviderDiscoveryItem> = {},
): SourceControlProviderDiscoveryItem => ({
  kind: SourceControlProviderKind.make(kind),
  label,
  executable: kind === "gitlab" ? "glab" : kind === "github" ? "gh" : undefined,
  status: "available",
  version: Option.none(),
  installHint: `Install ${label}.`,
  detail: Option.none(),
  auth: {
    status: "unauthenticated",
    account: Option.none(),
    host: Option.none(),
    detail: Option.none(),
  },
  ...extra,
});

const discovery = (
  sourceControlProviders: SourceControlDiscoveryResult["sourceControlProviders"],
): SourceControlDiscoveryResult => ({ versionControlSystems: [], sourceControlProviders });

const provider = (driver: string, extra: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "0.47.0",
  status: "ready",
  auth: { status: "authenticated", label: "ChatGPT Pro 20x Subscription" },
  checkedAt: "2026-10-12T10:15:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...extra,
});

const computer = (extra: Partial<ComputerFacts> = {}): ComputerFacts => ({
  name: "MacBook Pro",
  sourceControl: readyFact(
    discovery([
      tool("github", "GitHub", {
        auth: {
          status: "authenticated",
          account: Option.some("SemanS"),
          host: Option.none(),
          detail: Option.none(),
        },
      }),
      tool("bitbucket", "Bitbucket"),
      tool("gitlab", "GitLab", { status: "missing" }),
      tool("azure-devops", "Azure DevOps", { status: "missing" }),
      tool("forgejo", "Forgejo", { status: "missing" }),
    ]),
  ),
  providers: [
    provider("codex"),
    provider("claudeAgent", {
      auth: { status: "authenticated", label: "Claude Max Subscription" },
    }),
  ],
  agentBrowser: true,
  deviceHub: { enabled: false, status: "disabled", detail: null },
  ...extra,
});

const facts = (extra: Partial<OverviewFacts> = {}): OverviewFacts => ({
  peer: { kind: "ready", peer: peerFacts() },
  computer: computer(),
  ...extra,
});

const rowsOf = (groups: ReadonlyArray<OverviewGroup>, id: OverviewGroup["id"]) =>
  groups.find((group) => group.id === id)?.rows ?? [];
const rowNamed = (groups: ReadonlyArray<OverviewGroup>, name: string) =>
  groups.flatMap((group) => group.rows).find((row) => row.name === name);

describe("provider Overview destinations", () => {
  it("keeps each provider instance and the environment whose status is shown", () => {
    const groups = overviewRows(
      facts({ computer: computer({ environmentId: EnvironmentId.make("remote-server") }) }),
    );
    expect(rowNamed(groups, "Claude Code")?.action?.target).toEqual({
      kind: "settings",
      to: "/settings/providers",
      environmentId: "remote-server",
      instanceId: "claudeAgent",
    });
    expect(rowNamed(groups, "Codex")?.action?.target).toEqual({
      kind: "settings",
      to: "/settings/providers",
      environmentId: "remote-server",
      instanceId: "codex",
    });
  });
});

describe("the Overview of an admin", () => {
  const groups = overviewRows(facts());

  it("groups what Peer connects to by where it lives, in the design's order", () => {
    expect(groups.map((group) => [group.id, group.title, group.who])).toEqual([
      ["workspace", "Workspace", "Webinson · admins set these up"],
      ["computer", "This computer", "MacBook Pro"],
    ]);
    expect(rowsOf(groups, "workspace").map((row) => row.name)).toEqual([
      "Peer Hub",
      "GitHub PR checks",
    ]);
    expect(rowsOf(groups, "computer").map((row) => row.name)).toEqual([
      "GitHub CLI",
      "Bitbucket",
      "GitLab, Azure DevOps, Forgejo",
      "Codex",
      "Claude Code",
      "Browser for agents",
      "Device hub",
    ]);
  });

  it("tells the Hub as connected, with its address and build, as of the last sync", () => {
    expect(rowNamed(groups, "Peer Hub")).toMatchObject({
      connection: {
        state: "connected",
        detail: "hub.webinson.com · 0.1.0 (4787348)",
        checkedAt: "2026-10-12T10:20:00Z",
      },
      action: { label: "Hub" },
    });
  });

  it("reads GitHub's checks from what their page reads", () => {
    expect(rowNamed(groups, "GitHub PR checks")).toMatchObject({
      connection: { state: "off", detail: "Agents can’t prove a merge yet." },
      action: { label: "Turn on" },
      attention: false,
    });
  });

  it("lists the tools on this computer in the status language, and the accounts hidden", () => {
    expect(rowNamed(groups, "GitHub CLI")).toMatchObject({
      connection: { state: "connected", detail: "Signed in" },
      account: "SemanS",
      action: { label: "Source control" },
    });
    expect(rowNamed(groups, "Bitbucket")?.connection).toEqual({
      state: "setup",
      detail: "Sign in with an access token or an API token.",
    });
    expect(rowNamed(groups, "GitLab, Azure DevOps, Forgejo")).toMatchObject({
      connection: { state: "off", detail: "Their CLIs aren’t installed." },
      action: { label: "How to install" },
    });
    expect(rowNamed(groups, "Codex")?.connection).toMatchObject({
      state: "connected",
      detail: "ChatGPT Pro 20x Subscription · v0.47.0",
    });
    expect(rowNamed(groups, "Browser for agents")?.connection).toEqual({
      state: "connected",
      label: "Allowed",
      detail: "Agents may open pages in the built-in browser.",
    });
    expect(rowNamed(groups, "Device hub")?.connection.state).toBe("off");
  });

  it("never uses On, Enabled or Authenticated as a status", () => {
    for (const row of groups.flatMap((group) => group.rows)) {
      expect(row.connection.label ?? "").not.toMatch(/^(On|Enabled|Authenticated)$/);
      expect(row.connection.detail ?? "").not.toMatch(/^(On|Enabled|Authenticated)\b/);
    }
  });
});

describe("something to finish", () => {
  const groups = overviewRows(facts());

  it("names the first missing step in the banner, with what it means until then", () => {
    const waiting = overviewSummary(
      overviewRows(
        facts({
          peer: {
            kind: "ready",
            peer: peerFacts(workspace({ github: readyFact(github({ configured: true })) })),
          },
        }),
      ),
    );
    expect(waiting.first?.row.name).toBe("GitHub PR checks");
    expect(waiting.first?.text).toMatch(
      /^GitHub PR checks for Webinson is at step \d of \d: .+ Until then pull requests count as their agents report them\.$/,
    );
  });

  it("has nothing to finish, and no badge, when everything is connected or off", () => {
    const done = overviewSummary(
      overviewRows(
        facts({
          computer: computer({
            sourceControl: readyFact(discovery([tool("github", "GitHub", { status: "missing" })])),
          }),
        }),
      ),
    );
    expect(done.toFinish).toBe(0);
    expect(toFinishLabel(done)).toBeNull();
    expect(done.first).toBeNull();
  });

  it("filters to the rows that need attention, and drops a group with none", () => {
    expect(filterOverview(groups, "all")).toBe(groups);
    const waiting = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(workspace({ github: readyFact(github({ configured: true })) })),
        },
      }),
    );
    expect(filterOverview(waiting, "attention").map((group) => group.id)).toEqual(["workspace"]);
  });

  it("tells a problem in words, with its consequence", () => {
    const problem = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(
            workspace({
              github: readyFact(
                github({
                  configured: true,
                  lastPingAt: "2026-10-12T10:42:00Z",
                  lastVerifiedAt: "2026-10-12T10:42:00Z",
                }),
              ),
            }),
          ),
        },
      }),
    );
    const row = rowNamed(problem, "GitHub PR checks");
    expect(row?.connection.state).toBe("problem");
    expect(row && finishText(row)).toMatch(
      /^GitHub PR checks for Webinson: Its secret is not stored, .+ Until then pull requests count as their agents report them\.$/,
    );
    expect(overviewSummary(problem).toFinish).toBe(1);
  });
});

describe("what a member sees", () => {
  const member = overviewRows(
    facts({
      peer: { kind: "ready", peer: peerFacts(workspace({ role: "member" })) },
    }),
  );

  it("lists no page a member may not open: only the Hub of the workspace", () => {
    expect(member.map((group) => group.id)).toEqual(["workspace", "computer"]);
    expect(rowsOf(member, "workspace").map((row) => row.name)).toEqual(["Peer Hub"]);
    expect(member.find((group) => group.id === "workspace")?.who).toBe("Webinson");
  });
});

describe("a plugin that is not there", () => {
  const without = (id: string, extra: Partial<PeerPluginState>) =>
    PLUGINS.map((entry) => (entry.id === id ? { ...entry, ...extra } : entry));

  it("removes the rows of a plugin turned off", () => {
    const groups = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(workspace(), {
            plugins: without("github", { enabled: false, active: false, reason: "off" }),
          }),
        },
      }),
    );
    expect(rowNamed(groups, "GitHub PR checks")).toBeUndefined();
  });

  it("says Not available where the Hub cannot serve the feature yet", () => {
    const groups = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(workspace(), {
            plugins: without("github", { active: false, reason: "hub" }),
          }),
        },
      }),
    );
    expect(rowNamed(groups, "GitHub PR checks")).toMatchObject({
      connection: {
        state: "unavailable",
        detail: "This Peer Hub has no GitHub support yet.",
      },
      action: null,
    });
  });
});

describe("what is not read yet, and what failed", () => {
  it("says Checking… for a fact that has not arrived, and Problem only for one that failed", () => {
    const groups = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(
            workspace({
              github: { kind: "loading" },
            }),
          ),
        },
      }),
    );
    expect(rowNamed(groups, "GitHub PR checks")?.connection).toBe(CHECKING);
  });

  it("says a failed Hub sync is a Problem, and a sync that has not happened yet is not one", () => {
    const failed = overviewRows(
      facts({
        peer: { kind: "ready", peer: peerFacts(workspace(), { error: "Hub unreachable" }) },
      }),
    );
    expect(rowNamed(failed, "Peer Hub")?.connection.state).toBe("problem");
    const waiting = overviewRows(
      facts({ peer: { kind: "ready", peer: peerFacts(workspace(), { lastSyncAt: null }) } }),
    );
    expect(rowNamed(waiting, "Peer Hub")?.connection).toBe(CHECKING);
  });

  it("is only the Hub's row when nobody is signed in, and only This computer when Peer is out of reach", () => {
    const signedOut = overviewRows(
      facts({
        peer: { kind: "ready", peer: peerFacts(null, { signedIn: false, email: null }) },
      }),
    );
    expect(signedOut.map((group) => group.id)).toEqual(["workspace", "computer"]);
    expect(rowNamed(signedOut, "Peer Hub")).toMatchObject({
      connection: {
        state: "off",
        detail: "Peer Local works here. Connect a Hub to share work with a team.",
      },
      action: { label: "Sign in" },
    });

    const disconnected = overviewRows(facts({ peer: { kind: "disconnected" } }));
    expect(rowNamed(disconnected, "Peer Hub")?.connection.detail).toBe(
      "Peer is not connected on this computer.",
    );
    expect(overviewRows(facts({ peer: { kind: "loading" } }))[0]?.rows[0]?.connection).toBe(
      CHECKING,
    );
  });

  it("joins a workspace first when signed in with none", () => {
    const groups = overviewRows(facts({ peer: { kind: "ready", peer: peerFacts(null) } }));
    expect(groups.map((group) => group.id)).toEqual(["workspace", "computer"]);
    expect(rowNamed(groups, "Peer Hub")?.action?.label).toBe("Join a workspace");
  });
});
