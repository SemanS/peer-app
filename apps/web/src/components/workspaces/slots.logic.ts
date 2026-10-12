import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

import type {
  PeerWebPlugin,
  ProjectAction,
  ProjectSlotProps,
  TeamPluginSignal,
  TeamSlotInput,
  TeamTaskFact,
  TeamTaskSlotInput,
} from "./slots.types";

/**
 * The registry's plugins that are active on the environment, in registry order. A status without
 * a plugin list selects the features that existed before plugins; a plugin the status names but
 * the registry does not know is ignored.
 */
export function selectPeerPlugins<P extends { readonly id: string }>(
  registry: ReadonlyArray<P>,
  status: Pick<PeerHubStatus, "plugins"> | null,
): ReadonlyArray<P> {
  return registry.filter((plugin) => activePlugin(status, plugin.id));
}

/** Whether a colleague's shared thread can be watched here: Observe is among the active plugins. */
export function canWatchThreads(plugins: ReadonlyArray<{ readonly id: string }>): boolean {
  return plugins.some((plugin) => plugin.id === "observe");
}

/** What the plugins add to the Needs you count. */
export function needsYouCount(
  plugins: ReadonlyArray<PeerWebPlugin>,
  status: PeerHubStatus,
): number {
  return plugins.reduce((total, plugin) => total + (plugin.needsYou?.count?.(status) ?? 0), 0);
}

const NOTHING_NEEDS_YOU = "Nothing needs you right now.";

/** What an empty Needs you says: the first plugin with something to add, else the plain line. */
export function needsYouEmptyText(
  plugins: ReadonlyArray<PeerWebPlugin>,
  status: PeerHubStatus | null,
  running: number,
): string {
  if (status !== null) {
    for (const plugin of plugins) {
      const text = plugin.needsYou?.emptyText?.(status, { running });
      if (text !== undefined && text !== null) return text;
    }
  }
  return NOTHING_NEEDS_YOU;
}

/** A More menu item with the plugin that adds it: the dialog is told apart by both. */
export interface ProjectActionItem {
  readonly key: string;
  readonly action: ProjectAction;
}

/**
 * The items of a project's More menu: what the active plugins add, in the registry's order, leaving
 * out those the project's Hub cannot serve. A plugin that is off adds none.
 */
export function projectActionItems(
  plugins: ReadonlyArray<PeerWebPlugin>,
  props: ProjectSlotProps,
): ReadonlyArray<ProjectActionItem> {
  return plugins.flatMap((plugin) =>
    (plugin.projectActions ?? [])
      .filter((action) => action.available?.(props) !== false)
      .map((action) => ({ key: `${plugin.id}/${action.id}`, action })),
  );
}

/** A fact on the Team page with the plugin that adds it: two plugins may use the same id. */
export interface TeamTaskFactItem {
  readonly key: string;
  readonly fact: TeamTaskFact;
}

/**
 * The facts the active plugins add to a task's row on the Team page, in the registry's order: at
 * most one from each, and none from a plugin that is off.
 */
export function teamTaskFactsOf(
  plugins: ReadonlyArray<PeerWebPlugin>,
  input: TeamTaskSlotInput,
): ReadonlyArray<TeamTaskFactItem> {
  return plugins.flatMap((plugin) => {
    const fact = plugin.teamTaskFacts?.(input);
    return fact === undefined ? [] : [{ key: `${plugin.id}/${fact.id}`, fact }];
  });
}

/** A signal on the Team page with the plugin that adds it. */
export interface TeamPluginSignalItem {
  readonly key: string;
  readonly signal: TeamPluginSignal;
}

/** What the active plugins say needs a person on the Team page, in the registry's order. */
export function teamPluginSignalsOf(
  plugins: ReadonlyArray<PeerWebPlugin>,
  input: TeamSlotInput,
): ReadonlyArray<TeamPluginSignalItem> {
  return plugins.flatMap((plugin) =>
    (plugin.teamSignals?.(input) ?? []).map((signal) => ({
      key: `${plugin.id}/${signal.id}`,
      signal,
    })),
  );
}
