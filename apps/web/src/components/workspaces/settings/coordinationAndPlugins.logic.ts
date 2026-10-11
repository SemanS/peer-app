/**
 * What this computer's Coordination & plugins page (design artboard 13) works out: the default
 * policy its agents follow where a project sets none, which projects that default applies to and
 * which set a policy of their own, and each Peer plugin with whether it is on and where that comes
 * from. Pure, so the page only draws it. The Hub decides what a project's agents follow
 * (`effectivePolicy` is how this computer works it out); the plugins' state is the environment's.
 */
import { effectivePolicy, getAt } from "@t3tools/client-runtime/peer-settings";
import type {
  PeerCoordinationPolicy,
  PeerCoordinationState,
  PeerPluginState,
  PeerSettingsView,
} from "@t3tools/contracts";

import { pluginRows } from "../PeerPluginsSettings.logic";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---- the default policy ------------------------------------------------------------------------------

/**
 * The policies a person picks for their computer, with what each says of their agents. `exclusive`
 * is a project's alone (nobody changes a file another live session holds, which a computer cannot
 * promise for the others), so it is not offered here.
 */
export const DEFAULT_POLICIES: ReadonlyArray<{
  readonly value: PeerCoordinationPolicy;
  readonly hint: string;
}> = [
  { value: "notify", hint: "Your agents learn who else is on a file and keep going." },
  {
    value: "coordinate",
    hint: "Your agents wait until they confirm an overlap or leave a note.",
  },
  { value: "ask", hint: "Your agents ask you before they settle an overlap." },
];

export const isDefaultPolicy = (value: unknown): value is PeerCoordinationPolicy =>
  DEFAULT_POLICIES.some((policy) => policy.value === value);

/** What the chosen default says of the agents; null for one this app does not offer. */
export const defaultPolicyHint = (policy: string): string | null =>
  DEFAULT_POLICIES.find((candidate) => candidate.value === policy)?.hint ?? null;

/** What the section says while agent coordination is off, when no policy applies to anything. */
export const COORDINATION_OFF_NOTE =
  "Agent coordination is off on this computer, so no policy applies. Turn it on under Agent coordination below.";

// ---- where the default applies -----------------------------------------------------------------------

/** A project on this computer, with the workspace it is in: ids are only unique inside one. */
export interface ProjectRef {
  readonly workspace: string;
  readonly workspaceName: string;
  readonly id: string;
  readonly name: string;
}

/** A project that sets a policy of its own, and what this computer's default would have been there. */
export interface OwnPolicy {
  readonly project: ProjectRef;
  readonly policy: string;
  /** The default, shown struck through, where it differs; null where the project sets the same. */
  readonly overridden: string | null;
}

export interface DefaultSplit {
  /** Projects that set no policy, so the default decides. */
  readonly applies: ReadonlyArray<ProjectRef>;
  /** Projects that set one, which wins over the default. */
  readonly own: ReadonlyArray<OwnPolicy>;
  /** Projects of a workspace whose policies the Hub has not told this computer yet. */
  readonly unread: ReadonlyArray<ProjectRef>;
}

/**
 * Splits the projects of every workspace on this computer by whether the default applies: the Hub
 * names the policy a project sets itself, once it has been read, and says nothing of one that sets
 * none. A workspace not read yet (or an environment that reports no policies) leaves its projects
 * `unread`: from a missing policy the default would be claimed for a project that may set one.
 */
export function splitByDefault(
  workspaces: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly projects: ReadonlyArray<{
      readonly project: { readonly id: string; readonly name: string };
    }>;
  }>,
  policies: PeerCoordinationState["policies"],
  computerDefault: string,
): DefaultSplit {
  const applies: ProjectRef[] = [];
  const own: OwnPolicy[] = [];
  const unread: ProjectRef[] = [];
  for (const workspace of workspaces) {
    const known =
      policies !== undefined && Object.hasOwn(policies, workspace.slug)
        ? policies[workspace.slug]
        : undefined;
    for (const { project } of workspace.projects) {
      const ref: ProjectRef = {
        workspace: workspace.slug,
        workspaceName: workspace.name,
        id: project.id,
        name: project.name,
      };
      if (known === undefined) {
        unread.push(ref);
        continue;
      }
      const effective = effectivePolicy(known, project.id, computerDefault);
      if (effective.source === "computer") applies.push(ref);
      else
        own.push({
          project: ref,
          policy: effective.value,
          overridden: effective.overridden?.value ?? null,
        });
    }
  }
  return { applies, own, unread };
}

// ---- the plugins -------------------------------------------------------------------------------------

/** `warn` is amber: the plugin does not work as its owner set it, and the source says why. */
export type PluginTone = "ok" | "warn";

/** One plugin as the page draws it: the chip `<state> · <source>`, what to say under it, its switch. */
export interface PluginView {
  readonly id: string;
  readonly title: string;
  readonly state: "On" | "Off" | "Unavailable";
  /** Where that comes from: "by you", "turned off on this Hub", "needs a newer Hub". */
  readonly source: string;
  readonly tone: PluginTone;
  /** A line under the title: what forces it off, or what the Hub needs. */
  readonly note: string | null;
  /** What stops applying while the Hub keeps its feature off; the page words it with what it knows. */
  readonly consequence: "path-rules" | null;
  /** What its last cleanup, or its background work, failed with. */
  readonly error: string | null;
  /** The switch shows what is true now, not what its owner once chose, where the Hub or an operator decides. */
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly busy: boolean;
}

/**
 * The plugins whose Hub feature the signed-in Hub says it has turned off, by plugin id. Only a Hub
 * that serves settings says so (`features` of its view), and only for the features the settings
 * document holds the parts of: path rules, which are the resources plugin's, and webhooks.
 */
export function hubOffPlugins(features: PeerSettingsView["features"] | null): ReadonlySet<string> {
  const off = new Set<string>();
  if (features?.pathRules === false) off.add("resources");
  if (features?.webhooks === false) off.add("webhooks");
  return off;
}

/**
 * Each plugin of the environment with its state and where it comes from: the owner's own choice
 * (`by you`), an operator forcing it off, the Hub turning its feature off, or the Hub being too
 * old to have it. Its owner gets a switch to change their choice; everyone else reads it. Memory
 * stays out while the build leaves it out, as in `pluginRows`.
 */
export function pluginViews(
  plugins: ReadonlyArray<PeerPluginState>,
  input: {
    readonly owner: boolean;
    /** The plugin whose change is on its way. */
    readonly pending: string | null;
    readonly hubOff: ReadonlySet<string>;
  },
): ReadonlyArray<PluginView> {
  const own = input.owner ? "by you" : "by this computer’s owner";
  return pluginRows(plugins, { owner: input.owner, pending: input.pending }).map(
    (row): PluginView => {
      const base = {
        id: row.id,
        title: row.title,
        note: row.note,
        consequence: null,
        error: row.error,
        busy: row.busy,
      } as const;
      // The Hub or an operator decides these: the switch shows that, and is not for changing it.
      const decided = { checked: false, disabled: true } as const;
      if (row.locked) {
        return {
          ...base,
          ...decided,
          state: "Off",
          source: "forced off by the operator",
          tone: "warn",
        };
      }
      if (!row.on) {
        return {
          ...base,
          state: "Off",
          source: own,
          tone: "ok",
          checked: false,
          disabled: row.busy || !input.owner,
        };
      }
      if (input.hubOff.has(row.id)) {
        return {
          ...base,
          ...decided,
          note: null,
          consequence: row.id === "resources" ? "path-rules" : null,
          state: "Off",
          source: "turned off on this Hub",
          tone: "warn",
        };
      }
      if (row.state === "hub") {
        return {
          ...base,
          ...decided,
          state: "Unavailable",
          source: "needs a newer Hub",
          tone: "ok",
        };
      }
      return {
        ...base,
        state: "On",
        source: own,
        tone: "ok",
        checked: true,
        disabled: row.busy || !input.owner,
      };
    },
  );
}

/**
 * The names of the projects of a settings document that have path rules, among those whose ids it
 * is given (the projects the person is on: an admin's document holds every project of the workspace).
 */
export function projectsWithPathRules(
  document: unknown,
  ids: ReadonlySet<string>,
): ReadonlyArray<string> {
  const projects = getAt(document, ["projects"]);
  if (!isMapping(projects)) return [];
  return Object.entries(projects).flatMap(([id, project]) => {
    if (!ids.has(id)) return [];
    const paths = getAt(project, ["coordination", "paths"]);
    if (!isMapping(paths) || Object.keys(paths).length === 0) return [];
    const name = getAt(project, ["name"]);
    return [typeof name === "string" && name !== "" ? name : id];
  });
}

/** `Booking’s`, `Booking’s and Peer Hub’s`, `Booking’s, Peer Hub’s and Camp-bot’s`. */
function possessives(names: ReadonlyArray<string>): string {
  const owned = names.map((name) => `${name}’s`);
  return owned.length <= 1
    ? (owned[0] ?? "")
    : `${owned.slice(0, -1).join(", ")} and ${owned.at(-1)}`;
}

/** What stops applying while path rules are off on the Hub: the projects that have them. */
export const pathRulesNote = (names: ReadonlyArray<string>): string =>
  `${possessives(names)} path rules don’t apply while this is off.`;
