import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  PeerBudgetPeriod,
  PeerCurrency,
  PeerHarness,
  PeerTask,
  PeerWorkStatus,
  PeerWorkThread,
} from "./peer/base.ts";
import { PeerDomainClaim, PeerDomainOffer } from "./peer/domains.ts";
import { PeerGitHubState } from "./peer/github.ts";
import { PeerLocalAgent } from "./peer/herdr.ts";
import { PeerPluginState } from "./peer/plugin.ts";
import { peerPluginStatusFields } from "./peer/registry.ts";
import { PeerAgentRequest } from "./peer/requests.ts";

// Schemas plugins share moved to `peer/base.ts`, and each plugin's to `peer/<id>.ts`; their names
// stay importable from here.
export * from "./peer/base.ts";
export * from "./peer/domains.ts";
export * from "./peer/capacity.ts";
export * from "./peer/github.ts";
export * from "./peer/herdr.ts";
export * from "./peer/knowledge.ts";
export * from "./peer/observe.ts";
export * from "./peer/requests.ts";

/**
 * Peer Hub: the workspace service a Peer environment signs in to.
 *
 * People sign in with their email address (a one-time code), then join the
 * workspaces their address qualifies for — by its domain or by an invite —
 * or create one. A workspace declares projects, their repositories, agent
 * tools, knowledge and AI capacity; this environment provisions them
 * locally. The manifest mirrors the hub's
 * `GET /v1/workspaces/{slug}/manifest` (version 2). Unknown fields from a
 * newer hub are ignored on decode.
 */

export const PeerMcpServer = Schema.Union([
  Schema.Struct({
    transport: Schema.Literal("stdio"),
    command: Schema.String,
    args: Schema.Array(Schema.String),
    env: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    transport: Schema.Literals(["http", "sse"]),
    url: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
]);
export type PeerMcpServer = typeof PeerMcpServer.Type;

export const PeerTool = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mcp: PeerMcpServer,
  requires: Schema.Array(
    Schema.Struct({
      command: Schema.String,
      install: Schema.optional(Schema.String),
      docs: Schema.optional(Schema.String),
    }),
  ),
});
export type PeerTool = typeof PeerTool.Type;

export const PeerPersonalCapacityPolicy = Schema.Literals(["any", "commercial", "none"]);
export type PeerPersonalCapacityPolicy = typeof PeerPersonalCapacityPolicy.Type;

export const PeerWorkspaceRole = Schema.Literals(["owner", "admin", "member"]);
export type PeerWorkspaceRole = typeof PeerWorkspaceRole.Type;

export const PeerProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  client: Schema.optional(Schema.String),
  role: Schema.Literals(["lead", "member"]),
  members: Schema.Array(Schema.Struct({ email: Schema.String, name: Schema.String })),
  /** The product's areas in order; tasks sit under them. */
  areas: Schema.optional(Schema.Array(Schema.String)),
  /** Who shared the project from Peer, when it is not in the workspace configuration. */
  addedBy: Schema.optional(Schema.String),
  repositories: Schema.Array(
    Schema.Struct({ id: Schema.String, url: Schema.String, branch: Schema.String }),
  ),
  knowledge: Schema.Struct({ kontext: Schema.Boolean, company: Schema.Boolean }),
  tools: Schema.Array(PeerTool),
  capacity: Schema.Struct({
    personal: PeerPersonalCapacityPolicy,
    /** Harnesses the member declared a qualifying seat for (informational for "commercial"). */
    personalHarnesses: Schema.Array(PeerHarness),
    shared: Schema.optional(
      Schema.Struct({
        pool: Schema.String,
        gatewayUrl: Schema.String,
        models: Schema.Array(
          Schema.Struct({ id: Schema.String, harness: Schema.Array(PeerHarness) }),
        ),
        budget: Schema.Struct({
          amount: Schema.Number,
          period: PeerBudgetPeriod,
          currency: PeerCurrency,
        }),
        allocation: Schema.optional(Schema.Number),
        use: Schema.Array(Schema.Literals(["on-demand", "overflow", "automation"])),
      }),
    ),
  }),
});
export type PeerProject = typeof PeerProject.Type;

export const PeerManifest = Schema.Struct({
  version: Schema.Literal(2),
  workspace: Schema.Struct({
    slug: Schema.String,
    name: Schema.String,
    currency: PeerCurrency,
    revision: Schema.optional(Schema.String),
  }),
  member: Schema.Struct({
    email: Schema.String,
    name: Schema.String,
    role: PeerWorkspaceRole,
  }),
  knowledge: Schema.Struct({
    company: Schema.optional(
      Schema.Struct({ repository: Schema.String, branch: Schema.String, store: Schema.String }),
    ),
  }),
  projects: Schema.Array(PeerProject),
});
export type PeerManifest = typeof PeerManifest.Type;

export const PeerCheckoutState = Schema.Literals(["missing", "cloning", "ready", "error"]);
export type PeerCheckoutState = typeof PeerCheckoutState.Type;

export const PeerPresenceThread = Schema.Struct({
  title: Schema.String,
  status: Schema.String,
  branch: Schema.optional(Schema.String),
  harness: Schema.optional(Schema.String),
  capacity: Schema.optional(Schema.Literals(["personal", "shared"])),
});
export type PeerPresenceThread = typeof PeerPresenceThread.Type;

/** One workspace project as provisioned on this environment. */
export const PeerProjectState = Schema.Struct({
  project: PeerProject,
  repositories: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      url: Schema.String,
      branch: Schema.String,
      path: Schema.String,
      state: PeerCheckoutState,
      error: Schema.optional(Schema.String),
      /** Signing in to GitHub, with an account that can open the repository, fixes the error. */
      gitHubSignIn: Schema.optional(Schema.Boolean),
      projectId: Schema.optional(ProjectId),
    }),
  ),
  tools: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      /** Required commands not found on this environment's PATH, with how to install them. */
      missing: Schema.Array(
        Schema.Struct({ command: Schema.String, install: Schema.optional(Schema.String) }),
      ),
    }),
  ),
  sharedCapacity: Schema.Struct({
    enabled: Schema.Boolean,
    instanceIds: Schema.Array(Schema.String),
    error: Schema.optional(Schema.String),
  }),
  /**
   * The project's work: areas in order, tasks, and the threads other people and computers
   * report. This computer's own threads come live from its thread list.
   */
  work: Schema.Struct({
    areas: Schema.Array(Schema.String),
    tasks: Schema.Array(PeerTask),
    threads: Schema.Array(PeerWorkThread),
    /** This computer's threads (`peer:<thread id>`, `herdr:<terminal id>`) → task id. */
    assignments: Schema.Record(Schema.String, Schema.String),
  }),
  /** Colleagues' environments working on this project right now. */
  peers: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      name: Schema.String,
      environment: Schema.String,
      threads: Schema.Array(PeerPresenceThread),
      seenAt: Schema.String,
    }),
  ),
});
export type PeerProjectState = typeof PeerProjectState.Type;

/** A workspace this member belongs to, with what it provisions here. */
export const PeerWorkspaceState = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  role: PeerWorkspaceRole,
  /** Addresses in these domains may join without an invite. */
  allowedDomains: Schema.Array(Schema.String),
  domainClaims: Schema.optional(Schema.Array(PeerDomainClaim)),
  currency: PeerCurrency,
  /** Where the applied configuration came from, e.g. a registry commit. */
  revision: Schema.optional(Schema.String),
  memberName: Schema.String,
  companyKnowledge: Schema.NullOr(
    Schema.Struct({
      repository: Schema.String,
      path: Schema.String,
      state: PeerCheckoutState,
      error: Schema.optional(Schema.String),
    }),
  ),
  projects: Schema.Array(PeerProjectState),
  lastSyncAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type PeerWorkspaceState = typeof PeerWorkspaceState.Type;

/** A workspace this member may join: their address is in its domains, or they were invited. */
export const PeerJoinableWorkspace = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  allowedDomains: Schema.Array(Schema.String),
  reason: Schema.Literals(["domain", "invite"]),
});
export type PeerJoinableWorkspace = typeof PeerJoinableWorkspace.Type;

/**
 * What an agent about to change a file another agent on the project changed
 * is told: `notify` gives a heads-up, `coordinate` has it write the other
 * agent a note first, `ask` lets its person decide.
 */
export const PeerCoordinationPolicy = Schema.Literals(["notify", "coordinate", "ask"]);
export type PeerCoordinationPolicy = typeof PeerCoordinationPolicy.Type;

/**
 * What a project asks of its agents. A person's Settings pick one of the first
 * three for their computer, which only counts where the project sets none;
 * `exclusive` is the project's alone: nobody changes a file another live
 * session holds.
 */
export const PeerProjectPolicy = Schema.Literals(["notify", "coordinate", "ask", "exclusive"]);
export type PeerProjectPolicy = typeof PeerProjectPolicy.Type;

/** An agent session at work on a workspace project, as coordination sees it. */
export const PeerCoordSession = Schema.Struct({
  /** `claude:<session id>` */
  id: Schema.String,
  runtimeGeneration: Schema.optional(Schema.String),
  workspace: Schema.String,
  project: Schema.String,
  email: Schema.String,
  environment: Schema.optional(Schema.String),
  label: Schema.String,
  agent: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  status: PeerWorkStatus,
  /** Files it changed, relative to the repository. */
  files: Schema.Array(Schema.String),
  /** Files, or directories ending in `/`, it is about to change. */
  claims: Schema.Array(Schema.String),
  /** This computer runs it. */
  local: Schema.Boolean,
  /** When its agent last did something. */
  activeAt: Schema.optional(Schema.String),
});
export type PeerCoordSession = typeof PeerCoordSession.Type;

/** What the hub keeps of an overlap's acknowledgements; a hub from before them has none. */
const overlapAcknowledgements = {
  /** When the files it covers last changed: an acknowledgement counts only from then on. */
  filesAt: Schema.optional(Schema.String),
  /** When each of its sessions acknowledged it, by session id; a note counts as one. */
  acks: Schema.optional(Schema.Record(Schema.String, Schema.String)),
};

/**
 * Two agent sessions changing the same files. Its notes are the one thing
 * both agents and both people read about it.
 */
export const PeerOverlap = Schema.Struct({
  id: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  sessions: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  state: Schema.Literals(["open", "resolved"]),
  resolution: Schema.optional(Schema.String),
  notes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      /** The agent session that wrote it; none when a person did. */
      session: Schema.optional(Schema.String),
      email: Schema.String,
      text: Schema.String,
      at: Schema.String,
    }),
  ),
  updatedAt: Schema.String,
  ...overlapAcknowledgements,
  /** The agent session that closes it once its agents agree. */
  closer: Schema.optional(Schema.String),
  /** When a person asked its agents to settle it, unless an agent wrote since. */
  askedAt: Schema.optional(Schema.String),
});
export type PeerOverlap = typeof PeerOverlap.Type;

/** An overlap as the hub keeps it, which the coordination view and `intent` carry. */
export const PeerOverlapRecord = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  sessions: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  state: Schema.Literals(["open", "resolved"]),
  resolution: Schema.optional(Schema.String),
  resolvedFiles: Schema.optional(Schema.Array(Schema.String)),
  notes: PeerOverlap.fields.notes,
  ...overlapAcknowledgements,
  openedAt: Schema.String,
  updatedAt: Schema.String,
});
export type PeerOverlapRecord = typeof PeerOverlapRecord.Type;

/**
 * An agent about to change files asks the hub, which decides in one step: it
 * registers the session as a holder of each path, opens or extends the
 * overlaps with the other live sessions on it, and answers per path.
 */
export const PeerIntentRequest = Schema.Struct({
  environment: Schema.String,
  /** The agent session, `<agent>:<id>`. */
  session: Schema.String,
  /** Relative to the repository; at most 50. */
  paths: Schema.Array(Schema.String),
  /** This computer's own policy: it counts only where the project sets none. */
  policy: Schema.optional(PeerCoordinationPolicy),
  /** Names this command, so repeating it has no further effect. */
  op: Schema.optional(Schema.String),
});
export type PeerIntentRequest = typeof PeerIntentRequest.Type;

/**
 * What the hub decided about one path: `clear` (nobody else, or everything
 * acknowledged), `notify`, `deny` (`coordinate` and not acknowledged), `ask`
 * (the agent's person decides), `held` (`exclusive` and another live session
 * holds it).
 */
export const PeerIntentVerdictKind = Schema.Literals(["clear", "notify", "deny", "ask", "held"]);
export type PeerIntentVerdictKind = typeof PeerIntentVerdictKind.Type;

export const PeerIntentVerdict = Schema.Struct({
  path: Schema.String,
  verdict: PeerIntentVerdictKind,
  /** The other live sessions on the path. */
  with: Schema.Array(Schema.String),
  /** The overlaps (ids) with them, in `PeerIntentResponse.overlaps`. */
  overlaps: Schema.Array(Schema.String),
  /** For `held`: the session that holds the path. */
  holder: Schema.optional(Schema.String),
});
export type PeerIntentVerdict = typeof PeerIntentVerdict.Type;

export const PeerIntentResponse = Schema.Struct({
  /** The policy that decided, and whether the project set it or this computer's default did. */
  policy: PeerProjectPolicy,
  policySource: Schema.Literals(["project", "client"]),
  verdicts: Schema.Array(PeerIntentVerdict),
  /** The overlaps the verdicts name, in full. */
  overlaps: Schema.Array(PeerOverlapRecord),
  at: Schema.String,
});
export type PeerIntentResponse = typeof PeerIntentResponse.Type;

/** Agents on the same project staying out of each other's way (experimental). */
/** What an agent found for its team: a line of the "For the team" part of its working context. */
export const PeerFinding = Schema.Struct({
  id: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  task: Schema.optional(Schema.String),
  text: Schema.String,
  /** Whose agent found it. */
  email: Schema.String,
  at: Schema.String,
  /** `project` when its agent marked it as holding beyond its task. */
  scope: Schema.optional(Schema.Literals(["task", "project"])),
});
export type PeerFinding = typeof PeerFinding.Type;

/** Who keeps a shared context: one agent session at a time. */
export const PeerContextKeeper = Schema.Struct({
  /** `claude:<session id>` */
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  since: Schema.String,
  epoch: Schema.optional(Schema.Number),
});
export type PeerContextKeeper = typeof PeerContextKeeper.Type;

/**
 * The shared context of a task, or of a project's work on no task: kept by one
 * agent session (its keeper), read by the other agents on it and by people.
 */
export const PeerWorkContext = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  /** `task:<id>`, or `project` for work on no task. */
  scope: Schema.String,
  /** 0 until its first keeper writes it. */
  version: Schema.Number,
  epoch: Schema.optional(Schema.Number),
  keeper: Schema.optional(PeerContextKeeper),
  updatedAt: Schema.String,
  /** Who wrote this version: the keeper's person, or the person who brought an older one back. */
  updatedBy: Schema.optional(Schema.String),
  /** The agent session that wrote it; none when a person brought an older version back. */
  updatedSession: Schema.optional(Schema.String),
  restoredFrom: Schema.optional(Schema.Number),
  /** Where the work stands, in a line. */
  gist: Schema.optional(Schema.String),
  bytes: Schema.Number,
});
export type PeerWorkContext = typeof PeerWorkContext.Type;

export const PeerWorkContextText = Schema.Struct({
  ...PeerWorkContext.fields,
  text: Schema.String,
});
export type PeerWorkContextText = typeof PeerWorkContextText.Type;

/** A kept version of a shared context: who wrote it, when, and how much it changed. */
export const PeerContextVersion = Schema.Struct({
  version: Schema.Number,
  at: Schema.String,
  by: Schema.optional(Schema.String),
  /** The agent session that wrote it; none when a person brought an older version back. */
  session: Schema.optional(Schema.String),
  restoredFrom: Schema.optional(Schema.Number),
  bytes: Schema.Number,
  added: Schema.Number,
  dropped: Schema.Number,
});
export type PeerContextVersion = typeof PeerContextVersion.Type;

/** A kept version with its text and the lines it added and dropped. */
export const PeerContextVersionText = Schema.Struct({
  version: Schema.Number,
  at: Schema.String,
  by: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  restoredFrom: Schema.optional(Schema.Number),
  added: Schema.Array(Schema.String),
  dropped: Schema.Array(Schema.String),
  text: Schema.String,
});
export type PeerContextVersionText = typeof PeerContextVersionText.Type;

/**
 * What one of this computer's agents did with the team's work and knowledge, or what Peer noted of
 * it: it read a work's shared context, asked its agents, a model found work for it (`peer find`),
 * or an entry of the project's `.ai` governs files it changes. People see it to trust, or correct,
 * what their agents rely on.
 */
export const PeerAdvice = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  /** The agent session: `claude:<session id>` or `codex:<session id>`. */
  session: Schema.String,
  about: Schema.Literals(["work", "knowledge"]),
  /** A work: `task:<id>` or `project`. Knowledge: `kx:<entry id>`. */
  scope: Schema.String,
  /** How people name it: the work, or the knowledge entry's title. */
  name: Schema.String,
  /** The agent read it or asked its agents, a model found it for the agent, or an entry governs files it changes. */
  how: Schema.Literals(["read", "asked", "found", "governs"]),
  /** Why, in a sentence. */
  why: Schema.String,
  /** For knowledge: decision, convention, learning or incident. */
  entryKind: Schema.optional(Schema.String),
  /** For knowledge: where the entry is, relative to the repository. */
  path: Schema.optional(Schema.String),
  at: Schema.String,
});
export type PeerAdvice = typeof PeerAdvice.Type;

export const PeerCodexHookHome = Schema.Struct({
  home: Schema.String,
  hooksPath: Schema.String,
  /** At least one Peer hook is present, even if an incomplete set cannot coordinate. */
  present: Schema.Boolean,
  installed: Schema.Boolean,
  trusted: Schema.Boolean,
  reviewId: Schema.String,
  error: Schema.optional(Schema.String),
  hooks: Schema.Array(
    Schema.Struct({
      event: Schema.String,
      key: Schema.String,
      command: Schema.String,
      hash: Schema.String,
      matcher: Schema.optional(Schema.String),
      timeout: Schema.Number,
      enabled: Schema.Boolean,
      trusted: Schema.Boolean,
    }),
  ),
});
export type PeerCodexHookHome = typeof PeerCodexHookHome.Type;

export const PeerCoordinationState = Schema.Struct({
  enabled: Schema.Boolean,
  policy: PeerCoordinationPolicy,
  /** Claude Code runs Peer's coordination hooks. */
  claudeHooks: Schema.Boolean,
  claudeMod: Schema.optional(Schema.Boolean),
  /** Codex runs Peer's coordination hooks; absent from a Peer that cannot add them. */
  codexHooks: Schema.optional(Schema.Boolean),
  /** All configured Codex runtime homes have the complete, enabled, trusted Peer hook set. */
  codexHooksTrusted: Schema.optional(Schema.Boolean),
  codexHookHomes: Schema.optional(Schema.Array(PeerCodexHookHome)),
  /** Every coordination event, one JSON object per line. */
  logPath: Schema.String,
  sessions: Schema.Array(PeerCoordSession),
  overlaps: Schema.Array(PeerOverlap),
  /** What the agents on your projects found for the team, newest first. */
  findings: Schema.Array(PeerFinding),
  /** The shared contexts of your projects' tasks, without their text. */
  contexts: Schema.Array(PeerWorkContext),
  /** What this computer's agents did with the team's work and knowledge, newest first. */
  advice: Schema.optional(Schema.Array(PeerAdvice)),
  /** How many knowledge candidates wait for people, per project. */
  candidates: Schema.Array(
    Schema.Struct({ workspace: Schema.String, project: Schema.String, proposed: Schema.Number }),
  ),
});
export type PeerCoordinationState = typeof PeerCoordinationState.Type;

export const PeerHubStatus = Schema.Struct({
  /** The hub this environment signs in to (the default one until changed). */
  hubUrl: Schema.String,
  signedIn: Schema.Boolean,
  /** The verified address of the signed-in person. */
  email: Schema.NullOr(Schema.String),
  /** A code was mailed to this address and waits to be entered. */
  pendingSignIn: Schema.NullOr(
    Schema.Struct({
      email: Schema.String,
      sentAt: Schema.String,
      /** Only from a hub that echoes codes (local development and tests). */
      echoedCode: Schema.optional(Schema.String),
    }),
  ),
  workspaces: Schema.Array(PeerWorkspaceState),
  requests: Schema.optional(
    Schema.Array(Schema.Struct({ workspace: Schema.String, request: PeerAgentRequest })),
  ),
  joinable: Schema.Array(PeerJoinableWorkspace),
  domainOffers: Schema.optional(Schema.Array(PeerDomainOffer)),
  /** Directory workspace projects are checked out under, e.g. ~/Peer */
  workspaceRoot: Schema.String,
  /** This environment's server, so a client tells its own threads from everyone else's. */
  environmentId: Schema.String,
  /** Agents herdr runs on this computer, whether or not herdr is running. */
  agents: Schema.Struct({
    herdr: Schema.Literals(["running", "not-running"]),
    list: Schema.Array(PeerLocalAgent),
    postHocSkipped: Schema.optional(Schema.Number),
  }),
  github: PeerGitHubState,
  coordination: PeerCoordinationState,
  /** This computer's threads (`peer:…`, `herdr:…`) its owner lets the team watch. */
  sharedThreads: Schema.Array(Schema.String),
  syncing: Schema.Boolean,
  lastSyncAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  ...peerPluginStatusFields,
  /**
   * Peer's optional plugins on this environment and whether each is active. An environment from
   * before plugins sends none: the features that existed then are all active there.
   */
  plugins: Schema.optional(Schema.Array(PeerPluginState)),
});
export type PeerHubStatus = typeof PeerHubStatus.Type;

export const PeerHubStartSignInInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  /** Another hub than the current one, e.g. a company's own. */
  hubUrl: Schema.optional(TrimmedNonEmptyString),
});
export type PeerHubStartSignInInput = typeof PeerHubStartSignInInput.Type;

export const PeerHubFinishSignInInput = Schema.Struct({ code: TrimmedNonEmptyString });
export type PeerHubFinishSignInInput = typeof PeerHubFinishSignInInput.Type;

export const PeerHubCreateWorkspaceInput = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** Email domains whose people may join without an invite; the creator must have an address there. */
  allowedDomains: Schema.Array(TrimmedNonEmptyString),
});
export type PeerHubCreateWorkspaceInput = typeof PeerHubCreateWorkspaceInput.Type;

export const PeerHubWorkspaceInput = Schema.Struct({ workspace: TrimmedNonEmptyString });
export type PeerHubWorkspaceInput = typeof PeerHubWorkspaceInput.Type;

export const PeerHubFindWorkspaceInput = Schema.Struct({ slug: TrimmedNonEmptyString });
export type PeerHubFindWorkspaceInput = typeof PeerHubFindWorkspaceInput.Type;

/**
 * A workspace looked up by its short name. Its domains show only to those it concerns (members
 * and people it admits), so a lookup never reveals whose workspace it is.
 */
export const PeerFoundWorkspace = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(PeerWorkspaceRole),
  canJoin: Schema.Boolean,
  offer: Schema.optional(PeerDomainOffer),
  allowedDomains: Schema.Array(Schema.String),
});
export type PeerFoundWorkspace = typeof PeerFoundWorkspace.Type;

export const PeerHubInviteInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  role: Schema.optional(Schema.Literals(["admin", "member"])),
});
export type PeerHubInviteInput = typeof PeerHubInviteInput.Type;

export const PeerHubProjectInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
});
export type PeerHubProjectInput = typeof PeerHubProjectInput.Type;

export const PeerHubCreateTaskInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  key: Schema.optional(Schema.String),
  area: Schema.optional(Schema.String),
});
export type PeerHubCreateTaskInput = typeof PeerHubCreateTaskInput.Type;

export const PeerHubUpdateTaskInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  taskId: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  /** An empty string clears it. */
  area: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(["open", "review", "done"])),
});
export type PeerHubUpdateTaskInput = typeof PeerHubUpdateTaskInput.Type;

export const PeerHubTaskInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  taskId: TrimmedNonEmptyString,
});
export type PeerHubTaskInput = typeof PeerHubTaskInput.Type;

export const PeerHubAssignThreadInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  /** `peer:<thread id>` or `herdr:<terminal id>`. */
  thread: TrimmedNonEmptyString,
  taskId: Schema.NullOr(TrimmedNonEmptyString),
});
export type PeerHubAssignThreadInput = typeof PeerHubAssignThreadInput.Type;

export const PeerHubSetCoordinationInput = Schema.Struct({
  claudeMod: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
  policy: Schema.optional(PeerCoordinationPolicy),
  /** Add Peer's hooks to Claude Code's user settings, or take them out. */
  claudeHooks: Schema.optional(Schema.Boolean),
  /** Add Peer's hooks to configured Codex runtime homes, or take them out. */
  codexHooks: Schema.optional(Schema.Boolean),
  /** A person's approval of the exact Peer commands displayed for one configured home. */
  codexHookApproval: Schema.optional(
    Schema.Struct({
      home: TrimmedNonEmptyString,
      reviewId: TrimmedNonEmptyString,
    }),
  ),
});
export type PeerHubSetCoordinationInput = typeof PeerHubSetCoordinationInput.Type;

export const PeerHubOverlapNoteInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  overlap: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString,
});
export type PeerHubOverlapNoteInput = typeof PeerHubOverlapNoteInput.Type;

/** A person asks the agents on an overlap to settle it between them and close it. */
export const PeerHubSettleOverlapInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  overlap: TrimmedNonEmptyString,
  /** What the person adds for both agents. */
  message: Schema.optional(Schema.String),
});
export type PeerHubSettleOverlapInput = typeof PeerHubSettleOverlapInput.Type;

export const PeerHubResolveOverlapInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  overlap: TrimmedNonEmptyString,
  resolution: TrimmedNonEmptyString,
});
export type PeerHubResolveOverlapInput = typeof PeerHubResolveOverlapInput.Type;

/** A shared context; `version` is the one the caller knows of, so a newer one reads again. */
export const PeerHubContextInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  scope: TrimmedNonEmptyString,
  version: Schema.optional(Schema.Number),
});
export type PeerHubContextInput = typeof PeerHubContextInput.Type;

/** One committed coordination transition, with its participants and exact context version. */
export const PeerCoordEvent = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  project: Schema.String,
  at: Schema.String,
  email: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  paths: Schema.Array(Schema.String),
  overlap: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
  epoch: Schema.optional(Schema.Number),
  participants: Schema.Array(Schema.String),
  op: Schema.optional(Schema.String),
});
export type PeerCoordEvent = typeof PeerCoordEvent.Type;

export const PeerContextRead = Schema.Struct({
  project: Schema.String,
  scope: Schema.String,
  session: Schema.String,
  environment: Schema.String,
  version: Schema.Number,
  at: Schema.String,
});
export type PeerContextRead = typeof PeerContextRead.Type;

export const PeerStaleReads = Schema.Struct({
  fresh: Schema.Boolean,
  reads: Schema.optional(Schema.Array(PeerContextRead)),
  stale: Schema.Array(
    Schema.Struct({
      project: Schema.String,
      scope: Schema.String,
      readVersion: Schema.Number,
      currentVersion: Schema.NullOr(Schema.Number),
      at: Schema.String,
      updatedAt: Schema.NullOr(Schema.String),
    }),
  ),
});
export type PeerStaleReads = typeof PeerStaleReads.Type;

export const PeerHubCoordEventsInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  task: Schema.optional(TrimmedNonEmptyString),
  path: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 500 })),
  ),
  revision: Schema.optional(Schema.String),
});
export type PeerHubCoordEventsInput = typeof PeerHubCoordEventsInput.Type;

export const PeerHubStaleReadsInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  session: TrimmedNonEmptyString,
  environment: TrimmedNonEmptyString,
  revision: Schema.optional(Schema.String),
});
export type PeerHubStaleReadsInput = typeof PeerHubStaleReadsInput.Type;

export const PeerHubStartAgentInput = Schema.Struct({
  /** Claim this recipient request before starting; never launch twice on retry. */
  requestId: Schema.optional(TrimmedNonEmptyString),
  workspace: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  taskId: TrimmedNonEmptyString,
  repositoryId: TrimmedNonEmptyString,
  harness: Schema.Literals(["claude", "codex"]),
  prompt: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(20_000))),
});
export type PeerHubStartAgentInput = typeof PeerHubStartAgentInput.Type;
export const PeerHubStartAgentResult = Schema.Struct({
  paneId: Schema.String,
  terminalId: Schema.String,
  promptError: Schema.optional(Schema.String),
});
export type PeerHubStartAgentResult = typeof PeerHubStartAgentResult.Type;

/** One kept version of a shared context. */
export const PeerHubContextVersionInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  scope: TrimmedNonEmptyString,
  version: Schema.Number,
});
export type PeerHubContextVersionInput = typeof PeerHubContextVersionInput.Type;

export const PeerHubShareProjectInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  /** The local project whose repository the workspace gets... */
  projectId: Schema.optional(ProjectId),
  /** ...or a repository by its address: GitHub's `owner/repo` or a clone URL. */
  repository: Schema.optional(TrimmedNonEmptyString),
  name: Schema.optional(TrimmedNonEmptyString),
  areas: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type PeerHubShareProjectInput = typeof PeerHubShareProjectInput.Type;
