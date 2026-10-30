import { OpenSpecPlugin } from "../plugins/openspec/index.ts";
import { MetricsPlugin } from "../plugins/metrics/index.ts";
import { DigestPlugin } from "../plugins/digest/index.ts";
import { RecipesPlugin } from "../plugins/recipes/index.ts";
import { NeedsYouPlugin } from "../plugins/needs-you/index.ts";
import { SettlePlugin } from "../plugins/settle/index.ts";
import { ForecastPlugin } from "../plugins/forecast/index.ts";
import { ImpactPlugin } from "../plugins/impact/index.ts";
import { PlansPlugin } from "../plugins/plans/index.ts";
import { AgreementsPlugin } from "../plugins/agreements/index.ts";
import { ChangesPlugin } from "../plugins/changes/index.ts";
import { HandoffPlugin } from "../plugins/handoff/index.ts";
import { ResourcesPlugin } from "../plugins/resources/index.ts";
import { DependenciesPlugin } from "../plugins/dependencies/index.ts";
import { TestReportsPlugin } from "../plugins/test-reports/index.ts";
import { AcceptancePlugin } from "../plugins/acceptance/index.ts";
/**
 * The registry of Peer's plugins: every plugin of this build, in the order that fixes the order of
 * their text for agents and of their UI. Adding a plugin is one line in `peerPlugins`.
 *
 * @module peerHub/core/registry
 */
import * as Context from "effect/Context";
import { McpPlugin } from "../plugins/mcp/index.ts";

import { AuditPlugin } from "../plugins/audit/index.ts";
import { AnnouncementsPlugin } from "../plugins/announcements/index.ts";
import { AskPlugin } from "../plugins/ask/index.ts";
import { CapacityPlugin } from "../plugins/capacity/index.ts";
import { FindPlugin } from "../plugins/find/index.ts";
import { GitHubPlugin } from "../plugins/github/index.ts";
import { HerdrPlugin } from "../plugins/herdr/index.ts";
import { JujutsuPlugin } from "../plugins/jujutsu/index.ts";
import { KnowledgePlugin } from "../plugins/knowledge/index.ts";
import { MemoryPlugin } from "../plugins/memory/index.ts";
import { ObservePlugin } from "../plugins/observe/index.ts";
import { OwnershipPlugin } from "../plugins/ownership/index.ts";
import { RolesPlugin } from "../plugins/roles/index.ts";
import { ToolTrustPlugin } from "../plugins/tool-trust/index.ts";
import { RequestsPlugin } from "../plugins/requests/index.ts";
import { SettingsPlugin } from "../plugins/settings/index.ts";
import { SlackPlugin } from "../plugins/slack/index.ts";
import { WebhooksPlugin } from "../plugins/webhooks/index.ts";
import type { PeerPluginEntry } from "./plugin.ts";

/**
 * Core's `peer` commands; no plugin command may take one of their names. `core/broker/agentTools.ts`
 * is the agent tool catalog of these commands: change both together.
 */
export const CORE_COMMANDS = [
  "status",
  "note",
  "resolve",
  "claim",
  "release",
  "index",
  "current",
  "archive",
  "evidence",
  "context",
  "inputs",
  "ack",
  "review",
  "done",
  "run",
  "log",
  "task",
  "share",
  "help",
] as const;

/**
 * Peer's plugins, in registry order (`PEER_PLUGIN_IDS` in the contracts lists the same order). A
 * function, read once core starts: plugins import core's services, which import this module, so the
 * list must not be built while the modules load.
 */
export const peerPlugins = (): ReadonlyArray<PeerPluginEntry> => [
  HerdrPlugin,
  JujutsuPlugin,
  GitHubPlugin,
  DependenciesPlugin,
  HandoffPlugin,
  CapacityPlugin,
  RequestsPlugin,
  ObservePlugin,
  KnowledgePlugin,
  AskPlugin,
  FindPlugin,
  MemoryPlugin,
  WebhooksPlugin,
  SlackPlugin,

  AuditPlugin,
  ToolTrustPlugin,
  McpPlugin,
  AnnouncementsPlugin,
  NeedsYouPlugin,
  SettlePlugin,
  ResourcesPlugin,
  RecipesPlugin,
  ForecastPlugin,
  MetricsPlugin,
  DigestPlugin,
  ImpactPlugin,
  OwnershipPlugin,
  PlansPlugin,
  AgreementsPlugin,
  ChangesPlugin,
  OpenSpecPlugin,
  TestReportsPlugin,
  RolesPlugin,
  AcceptancePlugin,
  SettingsPlugin,
];

/** The plugins core runs: this build's, or a test's fakes. */
export class PeerPluginRegistry extends Context.Reference<ReadonlyArray<PeerPluginEntry>>(
  "t3/peerHub/core/registry/PeerPluginRegistry",
  { defaultValue: peerPlugins },
) {}

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
/** `peer <name>`: the shim puts it in a URL and a shell test, so it is a plain word. */
const COMMAND_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * What is wrong with a set of plugins, one sentence per problem; empty when nothing is. Ids must be
 * kebab-case and unique, and command names kebab-case and unique across core and every plugin.
 */
export function validatePlugins(
  plugins: ReadonlyArray<{
    readonly id: string;
    readonly commands?: ReadonlyArray<{ readonly name: string }> | undefined;
  }>,
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const ids = new Set<string>();
  const owners = new Map<string, string>(CORE_COMMANDS.map((name) => [name, "core"]));
  for (const plugin of plugins) {
    if (!PLUGIN_ID.test(plugin.id)) {
      problems.push(`Plugin id "${plugin.id}" is not kebab-case ([a-z][a-z0-9-]*).`);
    }
    if (ids.has(plugin.id)) problems.push(`Plugin "${plugin.id}" is listed twice.`);
    ids.add(plugin.id);
    for (const { name } of plugin.commands ?? []) {
      if (!COMMAND_NAME.test(name)) {
        problems.push(`Command "${name}" of plugin "${plugin.id}" is not kebab-case.`);
      }
      const owner = owners.get(name);
      if (owner === undefined) owners.set(name, plugin.id);
      else problems.push(`Command "${name}" of plugin "${plugin.id}" is already ${owner}'s.`);
    }
  }
  return problems;
}
