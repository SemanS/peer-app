/**
 * The This computer rows of Settings › Overview: Peer's Slack plugin, the hosting tools source
 * control found, the agent providers, the browser agents may open and the device hub. They are the
 * environment's own, whatever workspace is open.
 */
import type {
  DeviceHostStatus,
  ServerProvider,
  SourceControlDiscoveryResult,
} from "@t3tools/contracts";

import { CHECKING, CHECKING_LABEL, type ConnectionView, type Fact } from "./connectionFacts";
import {
  actionFor,
  overviewRow,
  pluginGate,
  type OverviewRow,
  type OverviewTarget,
} from "./overviewRow";
import { workspaceSlackConnection, type PeerFacts } from "./overviewWorkspace.logic";
import { getProviderVersionLabel } from "./providerStatus";
import { sourceControlStatus, type SourceControlDiscoveryItem } from "./sourceControl.logic";

/** The device hub as the Overview reads it. */
export interface DeviceHubFact {
  /** The setting that turns the hub on for this environment. */
  readonly enabled: boolean;
  /** What the hub reports; null while it has not. */
  readonly status: DeviceHostStatus | null;
  readonly detail: string | null;
}

/** What the Overview knows of the tools on the computer whose Peer it shows. */
export interface ComputerFacts {
  /** What the computer is called. */
  readonly name: string | null;
  /** Null where no environment is connected, so there is nothing to read. */
  readonly sourceControl: Fact<SourceControlDiscoveryResult> | null;
  readonly providers: ReadonlyArray<ServerProvider> | null;
  /** The setting that lets agents open pages in the built-in browser; null where it is not read. */
  readonly agentBrowser: boolean | null;
  readonly deviceHub: DeviceHubFact | null;
}

const settingsTarget = (
  to: "/settings/source-control" | "/settings/providers" | "/settings/integrations",
  targetId?: string,
): OverviewTarget => ({ kind: "settings", to, ...(targetId === undefined ? {} : { targetId }) });

const COORDINATION: OverviewTarget = {
  kind: "peer",
  location: { kind: "computer", section: "coordination" },
};

/**
 * Peer's Slack plugin on this computer. It waits for the workspace to connect Slack; once it has,
 * the plugin is Connected. Turned off here it says so, with the way back (the row stays: it is the
 * reverse of turning it off).
 */
export function slackPluginRow(peer: PeerFacts): OverviewRow {
  const gate = pluginGate(peer.status, "slack", "Slack");
  const workspace = peer.workspace;
  const open = (connection: ConnectionView): ConnectionView =>
    connection.state === "connected"
      ? { state: "connected", detail: "Your agents ask people in Slack when they wait." }
      : connection.label === CHECKING_LABEL
        ? CHECKING
        : {
            state: "off",
            label: "Waiting",
            detail: "Turned on for you; questions stay in Peer until Slack is connected.",
          };
  const plugin = peer.status.plugins?.find((candidate) => candidate.id === "slack");
  const connection: ConnectionView =
    gate.kind === "view"
      ? gate.view
      : gate.kind === "hidden"
        ? plugin?.locked === true
          ? { state: "off", detail: "Forced off by the operator." }
          : plugin === undefined
            ? { state: "unavailable", detail: "This version of Peer has no Slack plugin." }
            : {
                state: "off",
                detail: "Turned off on this computer: agents here do not ask in Slack.",
              }
        : workspace === null
          ? {
              state: "off",
              label: "Waiting",
              detail: "Turned on for you; it waits for a workspace to connect Slack.",
            }
          : open(workspaceSlackConnection(workspace));
  return overviewRow({
    id: "computer:slack-plugin",
    group: "computer",
    name: "Slack plugin",
    connection,
    action:
      connection.state === "unavailable"
        ? null
        : { label: "Coordination & plugins", target: COORDINATION },
  });
}

/** What a provider is called when its instance names none. */
const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude Code",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  pi: "Pi",
  acpRegistry: "ACP Registry",
};

/** What the tools source control found are called on the Overview. */
function toolName(item: SourceControlDiscoveryItem): string {
  return item.kind === "bitbucket" || item.executable === undefined
    ? item.label
    : `${item.label} CLI`;
}

/**
 * The hosting tools: GitHub and Bitbucket each on their own; the others (GitLab, Azure DevOps,
 * Forgejo…) each when installed, and the ones that are not installed in one Off row.
 */
export function sourceControlRows(
  fact: Fact<SourceControlDiscoveryResult> | null,
): ReadonlyArray<OverviewRow> {
  if (fact === null) return [];
  const target = settingsTarget("/settings/source-control");
  if (fact.kind !== "ready") {
    const connection: ConnectionView =
      fact.kind === "loading" ? CHECKING : { state: "problem", detail: fact.message };
    return [
      overviewRow({
        id: "computer:source-control",
        group: "computer",
        name: "Source control",
        connection,
        action: actionFor(connection, target, "Source control"),
      }),
    ];
  }
  const rows: OverviewRow[] = [];
  const notInstalled: SourceControlDiscoveryItem[] = [];
  for (const item of fact.value.sourceControlProviders) {
    const status = sourceControlStatus(item);
    const alwaysListed = item.kind === "github" || item.kind === "bitbucket";
    if (!alwaysListed && status.connection.state === "off") {
      notInstalled.push(item);
      continue;
    }
    rows.push(
      overviewRow({
        id: `computer:source-control:${item.kind}`,
        group: "computer",
        name: toolName(item),
        connection: status.connection,
        account: status.account,
        action: actionFor(status.connection, target, "Source control"),
      }),
    );
  }
  if (notInstalled.length > 0) {
    const connection: ConnectionView = {
      state: "off",
      detail: `${notInstalled.length === 1 ? "Its CLI isn’t" : "Their CLIs aren’t"} installed.`,
    };
    rows.push(
      overviewRow({
        id: "computer:source-control:others",
        group: "computer",
        name: notInstalled.map((item) => item.label).join(", "),
        connection,
        action: { label: "How to install", target },
      }),
    );
  }
  return rows;
}

/**
 * One agent provider: signed in and ready is Connected with its plan and version; installed but
 * signed out Needs setup; a provider that failed its checks, or could not be fully verified, has a
 * Problem. A provider that is not installed or is turned off is not a connection, so it is not listed.
 */
export function providerConnection(provider: ServerProvider): ConnectionView | null {
  if (!provider.installed || !provider.enabled || provider.status === "disabled") return null;
  if (provider.auth.status === "unauthenticated") {
    return { state: "setup", detail: "Sign in to use it with Peer." };
  }
  if (provider.status === "error") {
    return { state: "problem", detail: provider.message ?? "It failed its startup checks." };
  }
  if (provider.status === "warning") {
    return {
      state: "problem",
      detail: provider.message ?? "Installed, but Peer could not fully verify it.",
    };
  }
  const version = getProviderVersionLabel(provider.version);
  const plan = provider.auth.status === "authenticated" ? (provider.auth.label ?? null) : null;
  return {
    state: "connected",
    detail: [plan, version].filter((part) => part !== null).join(" · ") || undefined,
    checkedAt: provider.checkedAt,
  };
}

export function providerRows(
  providers: ReadonlyArray<ServerProvider> | null,
): ReadonlyArray<OverviewRow> {
  if (providers === null) return [];
  const target = settingsTarget("/settings/providers");
  return providers.flatMap((provider) => {
    const connection = providerConnection(provider);
    if (connection === null) return [];
    return [
      overviewRow({
        id: `computer:provider:${provider.instanceId}`,
        group: "computer",
        name: provider.displayName ?? PROVIDER_NAMES[provider.driver] ?? provider.driver,
        connection,
        action: actionFor(connection, target, "Providers"),
      }),
    ];
  });
}

function browserRow(allowed: boolean | null): OverviewRow | null {
  if (allowed === null) return null;
  const connection: ConnectionView = allowed
    ? {
        state: "connected",
        label: "Allowed",
        detail: "Agents may open pages in the built-in browser.",
      }
    : { state: "off", detail: "Agents may not open pages in the built-in browser." };
  return overviewRow({
    id: "computer:browser",
    group: "computer",
    name: "Browser for agents",
    connection,
    action: actionFor(
      connection,
      settingsTarget("/settings/integrations", "agent-browser-access"),
      "Browser & devices",
    ),
  });
}

/** The device hub: off until turned on; starting; ready; or failed, with what it reports. */
export function deviceHubConnection(hub: DeviceHubFact): ConnectionView {
  if (!hub.enabled)
    return { state: "off", detail: "Not turned on: no simulators or emulators for agents." };
  switch (hub.status) {
    case null:
      return CHECKING;
    case "disabled":
      return { state: "off", detail: "Not installed." };
    case "idle":
      return {
        state: "connected",
        label: "Ready",
        detail: "It starts when an agent needs a device.",
      };
    case "installing":
      return { state: "setup", detail: "Installing the device hub…" };
    case "starting":
      return { state: "setup", detail: "Starting the device hub…" };
    case "ready":
      return { state: "connected", detail: "Simulators and emulators are available to agents." };
    case "failed":
      return { state: "problem", detail: hub.detail ?? "The device hub failed to start." };
  }
}

function deviceHubRow(hub: DeviceHubFact | null): OverviewRow | null {
  if (hub === null) return null;
  const connection = deviceHubConnection(hub);
  return overviewRow({
    id: "computer:device-hub",
    group: "computer",
    name: "Device hub",
    connection,
    action: actionFor(
      connection,
      settingsTarget("/settings/integrations", "device-hub"),
      "Browser & devices",
    ),
  });
}

/** The This computer group, in the order the page lists it. */
export function computerRows(
  peer: PeerFacts | null,
  computer: ComputerFacts,
): ReadonlyArray<OverviewRow> {
  return [
    ...(peer === null || !peer.status.signedIn ? [] : [slackPluginRow(peer)]),
    ...sourceControlRows(computer.sourceControl),
    ...providerRows(computer.providers),
    browserRow(computer.agentBrowser),
    deviceHubRow(computer.deviceHub),
  ].filter((row): row is OverviewRow => row !== null);
}

/** Which agent a provider's driver runs, for the plans a person adds by agent. */
const HARNESS_OF_DRIVER: Readonly<Record<string, string>> = {
  claudeAgent: "claude",
  codex: "codex",
};

/**
 * How many plans the providers on this computer report that the person has not added: a signed-in
 * Claude Code or Codex on a subscription (not an API key), for an agent the person has no plan for.
 * One per agent, however many instances of it are set up. Peer never reads the sign-in itself, only
 * what the provider says of it. This is a count by agent; the AI subscriptions page lists the plans
 * it detected one by one, and the two must agree, so where that page has a helper for it the
 * Overview should call it instead.
 */
export function detectedPlanCount(
  providers: ReadonlyArray<ServerProvider>,
  addedHarnesses: ReadonlyArray<string>,
): number {
  const detected = new Set<string>();
  for (const provider of providers) {
    const harness = HARNESS_OF_DRIVER[provider.driver];
    if (harness === undefined || addedHarnesses.includes(harness)) continue;
    if (!provider.installed || !provider.enabled) continue;
    if (
      provider.auth.status === "authenticated" &&
      /subscription$/i.test(provider.auth.label ?? "")
    ) {
      detected.add(harness);
    }
  }
  return detected.size;
}
