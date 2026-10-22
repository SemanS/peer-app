import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  SourceControlProviderKind,
  type PeerGitHubStatus,
  type PeerPluginState,
  type PeerSlackAdminResult,
  type PeerSlackMe,
  type PeerWebhook,
  type PeerWebhookList,
  type ServerProvider,
  type SourceControlDiscoveryResult,
  type SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { CHECKING, failedFact, readyFact } from "./connectionFacts";
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

const PLUGINS = ["slack", "webhooks", "github", "capacity", "settings"].map((id) => plugin(id));

const slackAdmin = (extra: Partial<PeerSlackAdminResult> = {}): PeerSlackAdminResult => ({
  state: "needs-setup",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: null,
  bot: null,
  verifiedAt: null,
  auth: null,
  default: null,
  projects: [],
  lastPostAt: null,
  lastFailure: null,
  linkedMembers: 0,
  openAsks: 0,
  hubUrl: "https://hub.webinson.com",
  manifest: { eventsUrl: "https://hub/e", actionsUrl: "https://hub/a" },
  ...extra,
});

const slackMe = (extra: Partial<PeerSlackMe> = {}): PeerSlackMe => ({
  connected: false,
  team: null,
  bot: null,
  link: null,
  pending: null,
  settings: { enabled: false, delayMinutes: 2, place: "thread", kinds: [] },
  projects: [],
  ...extra,
});

const webhook = (extra: Partial<PeerWebhook> = {}): PeerWebhook => ({
  id: "ops",
  format: "slack",
  events: ["task.done"],
  projects: null,
  enabled: true,
  destination: { state: "ok", host: "hooks.slack.com" },
  signing: "derived",
  health: { pending: 0, failed: 0, lastDeliveredAt: "2026-10-12T09:00:00Z", lastFailure: null },
  ...extra,
});

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
  // Both values stored, not verified: step 3 of 4.
  slackAdmin: readyFact(slackAdmin()),
  slackMe: readyFact(slackMe()),
  webhooks: readyFact<PeerWebhookList>({
    revision: null,
    webhooks: [webhook(), webhook({ id: "teams", format: "teams" })],
  }),
  github: readyFact(github()),
  gateway: readyFact({
    view: {
      configured: true,
      url: "https://llm.webinson.com",
      adminUrl: null,
      currency: "EUR",
      masterKey: { stored: true, at: "2026-10-01T09:00:00Z" },
      sync: { at: "2026-10-12T10:00:00Z", ok: true, lastOkAt: "2026-10-12T10:00:00Z" },
    },
    pools: 2,
  }),
  plans: { kind: "ready", added: [], detected: 2 },
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
      ["me", "Me", "slavosmn@gmail.com"],
      ["computer", "This computer", "MacBook Pro"],
    ]);
    expect(rowsOf(groups, "workspace").map((row) => row.name)).toEqual([
      "Peer Hub",
      "Slack conversations",
      "Webhooks",
      "GitHub PR checks",
      "Shared capacity",
    ]);
    expect(rowsOf(groups, "me").map((row) => row.name)).toEqual([
      "Slack account",
      "AI subscriptions",
    ]);
    expect(rowsOf(groups, "computer").map((row) => row.name)).toEqual([
      "Slack plugin",
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

  it("says Slack needs setup at step 3 of 4, never Off or On, once both values are stored", () => {
    expect(rowNamed(groups, "Slack conversations")).toMatchObject({
      subject: "Slack for Webinson",
      connection: {
        state: "setup",
        step: { n: 3, of: 4, title: "verify the stored token with Slack" },
      },
      action: { label: "Continue setup" },
      attention: true,
      underway: true,
    });
  });

  it("reads webhooks, GitHub's checks and the gateway from what their pages read", () => {
    expect(rowNamed(groups, "Webhooks")?.connection).toEqual({
      state: "connected",
      detail: "2 delivering to Slack and Teams",
    });
    expect(rowNamed(groups, "GitHub PR checks")).toMatchObject({
      connection: { state: "off", detail: "Agents can’t prove a merge yet." },
      action: { label: "Turn on" },
      attention: false,
    });
    expect(rowNamed(groups, "Shared capacity")?.connection).toEqual({
      state: "connected",
      detail: "Gateway synced · 2 model pools",
      checkedAt: "2026-10-12T10:00:00Z",
    });
  });

  it("waits for the workspace to connect Slack, for the account and the plugin alike", () => {
    expect(rowNamed(groups, "Slack account")?.connection).toEqual({
      state: "off",
      label: "Waiting",
      detail: "For the workspace to connect Slack.",
    });
    expect(rowNamed(groups, "Slack plugin")?.connection).toEqual({
      state: "off",
      label: "Waiting",
      detail: "Turned on for you; questions stay in Peer until Slack is connected.",
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
  const summary = overviewSummary(groups);

  it("counts Slack as one to finish in the navigation and lists both rows under Needs attention", () => {
    expect(summary.toFinish).toBe(1);
    expect(toFinishLabel(summary)).toBe("1 to finish");
    const attention = filterOverview(groups, "attention");
    expect(attention.flatMap((group) => group.rows.map((row) => row.name))).toEqual([
      "Slack conversations",
      "AI subscriptions",
      "Bitbucket",
    ]);
    expect(summary.attention).toBe(3);
  });

  it("names the first missing step in the banner, with what it means until then", () => {
    expect(summary.first?.row.name).toBe("Slack conversations");
    expect(summary.first?.text).toBe(
      "Slack for Webinson is at step 3 of 4: verify the stored token with Slack. Until then agents ask only in Peer.",
    );
  });

  it("offers Review for plans the providers detected and the person has not added", () => {
    expect(rowNamed(groups, "AI subscriptions")).toMatchObject({
      connection: { state: "setup", detail: "2 plans detected on this computer, none added." },
      action: { label: "Review" },
      underway: false,
    });
  });

  it("has nothing to finish, and no badge, when everything is connected or off", () => {
    const done = overviewSummary(
      overviewRows(
        facts({
          peer: {
            kind: "ready",
            peer: peerFacts(
              workspace({
                slackAdmin: readyFact(
                  slackAdmin({
                    state: "connected",
                    team: { id: "T1", name: "Webinson" },
                    bot: { name: "peer" },
                    verifiedAt: "2026-10-12T10:00:00Z",
                    default: { id: "C1", name: "agents", private: false },
                  }),
                ),
                slackMe: readyFact(slackMe({ connected: true })),
                plans: { kind: "ready", added: ["Claude Max"], detected: 0 },
              }),
            ),
          },
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
    expect(filterOverview(groups, "attention").map((group) => group.id)).toEqual([
      "workspace",
      "me",
      "computer",
    ]);
    const quiet = overviewRows(
      facts({
        computer: computer({ sourceControl: null, providers: null, deviceHub: null }),
      }),
    );
    expect(filterOverview(quiet, "attention").map((group) => group.id)).toEqual([
      "workspace",
      "me",
    ]);
  });

  it("tells a problem in words, with its consequence", () => {
    const problem = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(
            workspace({
              slackAdmin: readyFact(
                slackAdmin({ auth: { code: "invalid_auth", at: "2026-10-12T10:42:00Z" } }),
              ),
            }),
          ),
        },
      }),
    );
    const row = rowNamed(problem, "Slack conversations");
    expect(row?.connection.state).toBe("problem");
    expect(row && finishText(row)).toBe(
      "Slack for Webinson: Slack does not accept the bot token; store it again and choose Verify. Until then agents ask only in Peer.",
    );
    expect(overviewSummary(problem).toFinish).toBe(1);
  });
});

describe("what a member sees", () => {
  const member = overviewRows(
    facts({
      peer: { kind: "ready", peer: peerFacts(workspace({ role: "member", slackAdmin: null })) },
    }),
  );

  it("lists no page a member may not open: only the Hub of the workspace", () => {
    expect(member.map((group) => group.id)).toEqual(["workspace", "me", "computer"]);
    expect(rowsOf(member, "workspace").map((row) => row.name)).toEqual(["Peer Hub"]);
    expect(member.find((group) => group.id === "workspace")?.who).toBe("Webinson");
  });

  it("keeps the member's own Slack account and plans", () => {
    expect(rowsOf(member, "me").map((row) => row.name)).toEqual([
      "Slack account",
      "AI subscriptions",
    ]);
  });
});

describe("a plugin that is not there", () => {
  const without = (id: string, extra: Partial<PeerPluginState>) =>
    PLUGINS.map((entry) => (entry.id === id ? { ...entry, ...extra } : entry));

  it("removes the rows of a plugin turned off, but keeps the plugin's own row to turn it back on", () => {
    const groups = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(workspace(), {
            plugins: without("slack", { enabled: false, active: false, reason: "off" }),
          }),
        },
      }),
    );
    expect(rowNamed(groups, "Slack conversations")).toBeUndefined();
    expect(rowNamed(groups, "Slack account")).toBeUndefined();
    expect(rowNamed(groups, "Slack plugin")).toMatchObject({
      connection: { state: "off" },
      action: { label: "Coordination & plugins" },
    });
    expect(overviewSummary(groups).toFinish).toBe(0);
  });

  it("says Not available where the Hub cannot serve the feature yet", () => {
    const groups = overviewRows(
      facts({
        peer: {
          kind: "ready",
          peer: peerFacts(workspace(), {
            plugins: without("webhooks", { active: false, reason: "hub" }),
          }),
        },
      }),
    );
    expect(rowNamed(groups, "Webhooks")).toMatchObject({
      connection: { state: "unavailable", detail: "This Peer Hub has no Webhooks support yet." },
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
              slackAdmin: { kind: "loading" },
              webhooks: failedFact("The Hub refused."),
              github: { kind: "loading" },
            }),
          ),
        },
      }),
    );
    expect(rowNamed(groups, "Slack conversations")?.connection).toBe(CHECKING);
    expect(rowNamed(groups, "GitHub PR checks")?.connection).toBe(CHECKING);
    expect(rowNamed(groups, "Webhooks")?.connection).toEqual({
      state: "problem",
      detail: "The Hub refused.",
    });
    expect(rowNamed(groups, "Slack plugin")?.connection).toBe(CHECKING);
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
    expect(rowNamed(signedOut, "Slack plugin")).toBeUndefined();

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
