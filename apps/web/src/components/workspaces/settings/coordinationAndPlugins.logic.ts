/**
 * What this computer's Coordination & plugins page (design artboard 13) works out: the default
 * policy its agents follow where a project sets none, which projects that default applies to and
 * which set a policy of their own, and each Peer plugin with whether it is on and where that comes
 * from. Pure, so the page only draws it. The Hub decides what a project's agents follow
 * (`effectivePolicy` is how this computer works it out); the plugins' state is the environment's.
 */
import { effectivePolicy, getAt } from "@t3tools/client-runtime/peer-settings";
import { isSlackAdmin, slackOlderHub } from "@t3tools/client-runtime/peer/slack";
import type {
  PeerCoordinationPolicy,
  PeerCoordinationState,
  PeerHubInfo,
  PeerPluginState,
  PeerSettingsView,
  PeerWorkspaceRole,
} from "@t3tools/contracts";

import type { ConnectionState } from "../../settings/connectionStatus.logic";
import { pluginRows } from "../PeerPluginsSettings.logic";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

/**
 * One plugin as the page draws it: the chip (its status in the one language every connection
 * speaks, then where that comes from), what to say under it, its switch. A plugin that is on and
 * served is Connected; Off is the owner's choice; Not available is the Hub, an operator or an
 * older Hub deciding.
 */
export interface PluginView {
  readonly id: string;
  readonly title: string;
  readonly status: ConnectionState;
  /** Says more than the state's name ("Checking…"). */
  readonly statusLabel?: string | undefined;
  /**
   * Where that comes from: "by you", "turned off on this Hub", "needs a newer Hub", "sign in to a
   * Peer Hub"; empty where the status needs nothing added.
   */
  readonly source: string;
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
 * The plugins whose Hub feature the signed-in Hub has turned off, by plugin id (a plugin's id is its
 * Hub feature's). A Hub lists the features its operator turned off in what it says of itself
 * (`featuresOff`). An older Hub does not; one that serves settings still says so for the features
 * the settings document holds the parts of (`features` of its view): path rules, which are the
 * resources plugin's, and webhooks.
 */
export function hubOffPlugins(
  hub: Pick<PeerHubInfo, "featuresOff"> | undefined,
  features: PeerSettingsView["features"] | null,
): ReadonlySet<string> {
  if (hub?.featuresOff !== undefined) return new Set(hub.featuresOff);
  const off = new Set<string>();
  if (features?.pathRules === false) off.add("resources");
  if (features?.webhooks === false) off.add("webhooks");
  return off;
}

/**
 * Each plugin of the environment with its status and where it comes from: the owner's own choice
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
    /** The plugins the Hub was built without (`featuresBuiltWithout`): an update does not fix those. */
    readonly builtWithout?: ReadonlySet<string>;
    /** Whether someone is signed in to a Hub, when known. */
    readonly signedIn?: boolean;
  },
): ReadonlyArray<PluginView> {
  const own = input.owner ? "by you" : "by this computer’s owner";
  return pluginRows(plugins, input).map((row): PluginView => {
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
        status: "unavailable",
        source: "forced off by the operator",
      };
    }
    if (!row.on) {
      return {
        ...base,
        status: "off",
        source: own,
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
        status: "unavailable",
        source: "turned off on this Hub",
      };
    }
    if (row.state === "hub") {
      return input.builtWithout?.has(row.id) === true
        ? {
            ...base,
            ...decided,
            note: null,
            status: "unavailable",
            source: "this Hub was built without it",
          }
        : { ...base, ...decided, status: "unavailable", source: "needs a newer Hub" };
    }
    if (row.state === "waiting") {
      // Signed out nothing is being checked: the plugin works once the person signs in.
      return input.signedIn === false
        ? { ...base, ...decided, status: "unavailable", source: "sign in to a Peer Hub" }
        : { ...base, ...decided, status: "off", statusLabel: "Checking…", source: "" };
    }
    return {
      ...base,
      status: "connected",
      source: own,
      checked: true,
      disabled: row.busy || !input.owner,
    };
  });
}

/** Where the Slack row sends a person: the admins to the setup, everyone else to their own page. */
export interface SlackPluginLink {
  readonly section: "integrations" | "slack";
  readonly label: string;
}

/** One workspace's line of the Slack plugin row: the chip, where it comes from, a note and a link. */
export interface SlackPluginLine {
  readonly status: ConnectionState;
  readonly statusLabel?: string | undefined;
  /** After the chip: "for Webinson to connect Slack", or the workspace's name when several are listed. */
  readonly source: string;
  readonly note: string | null;
  readonly link: SlackPluginLink | null;
}

/**
 * What the Slack plugin row says of a workspace while the plugin is on and served. The plugin works
 * on this computer, but nothing is asked in Slack until the workspace has connected it: that reads
 * Waiting, for the workspace, with the way to do it (the setup for an admin, the page naming the
 * admins for a member). Once connected it says where each person sets what reaches them.
 */
export function slackPluginLine(input: {
  readonly workspace: {
    readonly name: string;
    readonly role: PeerWorkspaceRole;
  };
  /** What the member's view of Slack says; null while it has not arrived. */
  readonly connected: boolean | null;
  /** Why the view could not be read, if it could not. */
  readonly error: string | null;
  /** The computer's owner reads "on for you"; anyone else reads "on for this computer". */
  readonly owner: boolean;
  /** Several workspaces are listed, so each line says which it is about. */
  readonly named: boolean;
}): SlackPluginLine {
  const { workspace, connected, error, owner, named } = input;
  if (error !== null) {
    return slackOlderHub(error)
      ? { status: "unavailable", source: "needs a newer Hub", note: null, link: null }
      : { status: "problem", source: "could not read Slack from the Hub", note: null, link: null };
  }
  if (connected === null) {
    return { status: "off", statusLabel: "Checking…", source: "", note: null, link: null };
  }
  if (connected) {
    return {
      status: "connected",
      source: named ? workspace.name : "",
      note: "Agents on this computer can ask you in Slack, as set in Me › Slack.",
      link: { section: "slack", label: "Me › Slack" },
    };
  }
  return {
    status: "off",
    statusLabel: "Waiting",
    source: `for ${workspace.name} to connect Slack`,
    note: `${owner ? "On for you" : "On for this computer"}, but ${workspace.name} hasn’t connected Slack. Agents’ questions stay in Peer meanwhile.`,
    link: isSlackAdmin(workspace.role)
      ? { section: "integrations", label: "Open Slack setup" }
      : { section: "slack", label: "Me › Slack" },
  };
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
