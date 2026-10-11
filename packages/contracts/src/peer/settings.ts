import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Peer's settings plugin: workspace and project settings changed in the app, with their history
 * (the Hub's `settings` feature), and agents proposing changes that owners review. Everything here
 * mirrors the Hub's wire contract field for field (camelCase, times as RFC 3339 strings, a `path`
 * an array of strings). Names of open vocabularies (a line's scope kind, when a change applies,
 * where a revision came from, a diagnostic's severity) are plain strings, so an app of one age
 * reads a Hub of another; the values known today are listed beside them.
 */
export const PEER_SETTINGS_PLUGIN = {
  id: "settings",
  title: "Workspace settings",
  summary:
    "Change workspace and project settings in the app, keep their history, and let agents propose changes for owners to review.",
  hubFeature: { id: "settings", revision: 1 },
  commandNames: ["config"],
} as const;

const Role = Schema.Literals(["owner", "admin", "member"]);
const Text = Schema.String;
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
/** A revision number, as the Hub counts them: 1 is the first. */
const Seq = Count;
const NullableText = Schema.optional(Schema.NullOr(Schema.String));

/** A person as the Hub names them in lines, revisions and proposals. */
export const PeerSettingsPerson = Schema.Struct({ email: Text, name: Text });
export type PeerSettingsPerson = typeof PeerSettingsPerson.Type;

/** A node of the settings document: `["projects","booking","coordination","paths","migrations/**"]`. */
export const PeerSettingsPath = Schema.Array(Text);
export type PeerSettingsPath = typeof PeerSettingsPath.Type;

/** One value to set; `null` removes the node. */
export const PeerSettingsSet = Schema.Struct({ path: PeerSettingsPath, value: Schema.Unknown });
export type PeerSettingsSet = typeof PeerSettingsSet.Type;

/** What a line is about: `kind` is `workspace`, `project` or `person`. */
export const PeerSettingsScope = Schema.Struct({ kind: Text, id: Text, name: Text });
export type PeerSettingsScope = typeof PeerSettingsScope.Type;

/** One change in words (`Booking · Coordination: notify → coordinate`), as the Hub writes it. */
export const PeerSettingsLine = Schema.Struct({
  path: PeerSettingsPath,
  scope: PeerSettingsScope,
  label: Text,
  from: Text,
  to: Text,
});
export type PeerSettingsLine = typeof PeerSettingsLine.Type;

/** Two people changed the same node: raw values (`null` is absent) and the words for each. */
export const PeerSettingsConflict = Schema.Struct({
  path: PeerSettingsPath,
  label: Text,
  base: Schema.Unknown,
  mine: Schema.Unknown,
  theirs: Schema.Unknown,
  baseText: Text,
  mineText: Text,
  theirsText: Text,
  theirsBy: PeerSettingsPerson,
  theirsAt: Text,
  theirsSeq: Seq,
});
export type PeerSettingsConflict = typeof PeerSettingsConflict.Type;

/** What the workspace check found: `severity` is `warning` or `error`, `at` a dotted location. */
export const PeerSettingsDiagnostic = Schema.Struct({
  severity: Text,
  at: Text,
  message: Text,
});
export type PeerSettingsDiagnostic = typeof PeerSettingsDiagnostic.Type;

/** When a kind of change takes effect; `kind` is next-edit, after-approval, after-sync, on-sync, clone or now. */
export const PeerSettingsApplies = Schema.Struct({ kind: Text, text: Text });
export type PeerSettingsApplies = typeof PeerSettingsApplies.Type;

/** The head a change was made against. */
export const PeerSettingsHead = Schema.Struct({
  seq: Seq,
  by: PeerSettingsPerson,
  at: Text,
});
export type PeerSettingsHead = typeof PeerSettingsHead.Type;

/** A revision as `GET /settings` names the latest one. */
export const PeerSettingsRevision = Schema.Struct({
  seq: Seq,
  commit: Text,
  at: Text,
  by: PeerSettingsPerson,
  message: Text,
});
export type PeerSettingsRevision = typeof PeerSettingsRevision.Type;

/** A revision in the history: `source` is app, cli, proposal, import, revert, seed or gap. */
export const PeerSettingsRevisionEntry = Schema.Struct({
  ...PeerSettingsRevision.fields,
  source: Text,
  proposal: NullableText,
  lines: Schema.Array(PeerSettingsLine),
});
export type PeerSettingsRevisionEntry = typeof PeerSettingsRevisionEntry.Type;

/** One revision, with what only admins get: the files it changed and a unified diff of each. */
export const PeerSettingsRevisionDetail = Schema.Struct({
  ...PeerSettingsRevisionEntry.fields,
  files: Schema.optional(Schema.Array(Schema.Struct({ path: Text, diff: Text }))),
});
export type PeerSettingsRevisionDetail = typeof PeerSettingsRevisionDetail.Type;

export const PeerSettingsHistoryPage = Schema.Struct({
  revisions: Schema.Array(PeerSettingsRevisionEntry),
  next: Schema.optional(Schema.NullOr(Seq)),
});
export type PeerSettingsHistoryPage = typeof PeerSettingsHistoryPage.Type;

/** What the caller owns: every workspace setting (`admin`), the domains too (`owner`), these projects. */
export const PeerSettingsRights = Schema.Struct({
  admin: Schema.Boolean,
  owner: Schema.Boolean,
  leads: Schema.Array(Text),
});
export type PeerSettingsRights = typeof PeerSettingsRights.Type;

/** `GET /settings`: the visible part of the settings document, and who the caller is in it. */
export const PeerSettingsView = Schema.Struct({
  revision: PeerSettingsRevision,
  rights: PeerSettingsRights,
  /** An open JSON object: read its parts with the narrow schemas below. */
  document: Schema.Record(Schema.String, Schema.Unknown),
  features: Schema.Struct({
    pathRules: Schema.Boolean,
    webhooks: Schema.Boolean,
    github: Schema.Boolean,
  }),
  people: Schema.Array(Schema.Struct({ ...PeerSettingsPerson.fields, role: Role })),
});
export type PeerSettingsView = typeof PeerSettingsView.Type;

/** A refused path of a change, with who may change it ("admins", "Booking's leads and admins"). */
export const PeerSettingsRefusal = Schema.Struct({
  path: PeerSettingsPath,
  label: Text,
  owners: Text,
});
export type PeerSettingsRefusal = typeof PeerSettingsRefusal.Type;

/** What a change would do, as a dry run answers it. */
export const PeerSettingsPreview = Schema.Struct({
  base: Seq,
  head: PeerSettingsHead,
  lines: Schema.Array(PeerSettingsLine),
  conflicts: Schema.Array(PeerSettingsConflict),
  diagnostics: Schema.Array(PeerSettingsDiagnostic),
  applies: Schema.Array(PeerSettingsApplies),
  noop: Schema.Boolean,
});
export type PeerSettingsPreview = typeof PeerSettingsPreview.Type;

/** The gateway's reconciliation after a save: it worked, or why not; absent when untouched. */
export const PeerSettingsGatewayOutcome = Schema.Union([
  Schema.Struct({ ok: Schema.Boolean }),
  Schema.Struct({ error: Text }),
]);
export type PeerSettingsGatewayOutcome = typeof PeerSettingsGatewayOutcome.Type;

/** A change after it was saved: the preview it made, then the revision it became. */
export const PeerSettingsSaved = Schema.Struct({
  ...PeerSettingsPreview.fields,
  revision: Schema.optional(Schema.Struct({ seq: Seq, commit: Text, at: Text })),
  gateway: Schema.optional(PeerSettingsGatewayOutcome),
  audit: Schema.optional(Text),
});
export type PeerSettingsSaved = typeof PeerSettingsSaved.Type;

/**
 * What a change, revert, import, applied proposal or GitHub removal comes to, as the app
 * answers it. A dry run is a `preview`, a save is `saved`. The Hub's refusals are results too, not
 * errors, because each is a way these flows go that a person resolves: `conflict` (409
 * `settings_conflict`, the preview with `conflicts` to settle), `forbidden` (403 `settings_forbidden`,
 * the refused paths and who may change them) and `invalid` (422 `invalid_settings`, the
 * diagnostics). Anything else fails as a `PeerHubError`.
 */
export const PeerSettingsChangeResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("preview"), ...PeerSettingsPreview.fields }),
  Schema.Struct({ kind: Schema.Literal("saved"), ...PeerSettingsSaved.fields }),
  Schema.Struct({ kind: Schema.Literal("conflict"), ...PeerSettingsPreview.fields }),
  Schema.Struct({
    kind: Schema.Literal("forbidden"),
    refused: Schema.Array(PeerSettingsRefusal),
  }),
  Schema.Struct({
    kind: Schema.Literal("invalid"),
    diagnostics: Schema.Array(PeerSettingsDiagnostic),
  }),
]);
export type PeerSettingsChangeResult = typeof PeerSettingsChangeResult.Type;

/** Who proposed it: an agent on a person's behalf (`kind` is `agent`). */
export const PeerSettingsVia = Schema.Struct({
  kind: Text,
  agent: Schema.optional(Text),
  thread: Schema.optional(Text),
});
export type PeerSettingsVia = typeof PeerSettingsVia.Type;

/** A proposal: `state` is pending, applied, declined, withdrawn or expired. */
export const PeerSettingsProposal = Schema.Struct({
  id: Text,
  by: PeerSettingsPerson,
  via: Schema.optional(Schema.NullOr(PeerSettingsVia)),
  at: Text,
  base: Seq,
  message: Text,
  instruction: NullableText,
  lines: Schema.Array(PeerSettingsLine),
  scopes: Schema.Array(Text),
  owners: Text,
  state: Text,
  decidedBy: Schema.optional(Schema.NullOr(PeerSettingsPerson)),
  decidedAt: NullableText,
  reason: NullableText,
  revision: Schema.optional(Schema.NullOr(Seq)),
  /** The caller proposed it. */
  mine: Schema.Boolean,
  /** The caller owns everything it touches, so may save or decline it. */
  canDecide: Schema.Boolean,
  /** Warnings of the configuration check, when the Hub sends them. */
  diagnostics: Schema.optional(Schema.Array(PeerSettingsDiagnostic)),
});
export type PeerSettingsProposal = typeof PeerSettingsProposal.Type;

export const PeerSettingsProposals = Schema.Struct({
  proposals: Schema.Array(PeerSettingsProposal),
});
export type PeerSettingsProposals = typeof PeerSettingsProposals.Type;

/** A proposal was made, or the Hub could not take it (`forbidden` or `invalid`, as for a change). */
export const PeerSettingsProposeResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("proposed"), proposal: PeerSettingsProposal }),
  Schema.Struct({
    kind: Schema.Literal("forbidden"),
    refused: Schema.Array(PeerSettingsRefusal),
  }),
  Schema.Struct({
    kind: Schema.Literal("invalid"),
    diagnostics: Schema.Array(PeerSettingsDiagnostic),
  }),
]);
export type PeerSettingsProposeResult = typeof PeerSettingsProposeResult.Type;

/** A secret's name, when it was last stored and by whom, and what uses it. */
export const PeerSettingsSecretsView = Schema.Struct({
  secrets: Schema.Array(
    Schema.Struct({
      name: Text,
      at: NullableText,
      by: Schema.optional(Schema.NullOr(PeerSettingsPerson)),
      usedBy: Schema.Array(Text),
    }),
  ),
  /** Names something refers to that nobody stored. */
  missing: Schema.Array(Schema.Struct({ name: Text, usedBy: Schema.Array(Text) })),
});
export type PeerSettingsSecretsView = typeof PeerSettingsSecretsView.Type;

/** The last reconciliation with the gateway. */
export const PeerSettingsSync = Schema.Struct({
  at: Text,
  ok: Schema.Boolean,
  error: Schema.optional(Text),
  lastOkAt: NullableText,
});
export type PeerSettingsSync = typeof PeerSettingsSync.Type;

export const PeerSettingsGatewayView = Schema.Struct({
  configured: Schema.Boolean,
  url: NullableText,
  adminUrl: NullableText,
  usdPerUnit: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: NullableText,
  masterKey: Schema.Struct({
    stored: Schema.Boolean,
    at: NullableText,
    by: Schema.optional(Schema.NullOr(PeerSettingsPerson)),
  }),
  sync: Schema.optional(Schema.NullOr(PeerSettingsSync)),
});
export type PeerSettingsGatewayView = typeof PeerSettingsGatewayView.Type;

/** The gateway's models, listed with the master key. */
export const PeerSettingsGatewayTest = Schema.Struct({
  ok: Schema.Boolean,
  models: Schema.optional(Schema.Array(Text)),
  error: Schema.optional(Text),
});
export type PeerSettingsGatewayTest = typeof PeerSettingsGatewayTest.Type;

/** What GitHub needs to send its signed webhooks; `secret` is in this answer only. */
export const PeerSettingsGitHubSetup = Schema.Struct({
  payloadUrl: Text,
  secret: NullableText,
  secretName: Text,
  events: Text,
  revision: Schema.optional(Schema.NullOr(Seq)),
});
export type PeerSettingsGitHubSetup = typeof PeerSettingsGitHubSetup.Type;

/** The TXT record that proves control of a domain; `state` is verified, claimed or listed. */
export const PeerDomainRecord = Schema.Struct({ domain: Text, record: Text, state: Text });
export type PeerDomainRecord = typeof PeerDomainRecord.Type;

/** What a check of a domain found: `dns` is found, missing, unavailable or off. */
export const PeerSettingsDomainCheck = Schema.Struct({
  domain: Text,
  state: Text,
  dns: Text,
  record: Schema.optional(Text),
});
export type PeerSettingsDomainCheck = typeof PeerSettingsDomainCheck.Type;

export const PeerSettingsExport = Schema.Struct({
  revision: Schema.Struct({ seq: Seq, commit: Text }),
  /** File path → its YAML, plus `.peer-revision` holding `<seq> <commit>`. */
  files: Schema.Record(Schema.String, Schema.String),
});
export type PeerSettingsExport = typeof PeerSettingsExport.Type;

/** The workspace after a rename or a change of domains. */
export const PeerSettingsWorkspace = Schema.Struct({
  slug: Text,
  name: Text,
  allowedDomains: Schema.Array(Text),
});
export type PeerSettingsWorkspace = typeof PeerSettingsWorkspace.Type;

/**
 * A rename or new domains: `updated`, or `domain-claimed` (409), when another workspace holds a
 * domain: the record that would prove this one controls it, and who holds it.
 */
export const PeerSettingsWorkspaceUpdate = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("updated"), workspace: PeerSettingsWorkspace }),
  Schema.Struct({
    kind: Schema.Literal("domain-claimed"),
    domain: Text,
    record: Text,
    holder: Schema.optional(Schema.Struct({ slug: Text, name: Text, verified: Schema.Boolean })),
    dns: Schema.optional(Text),
  }),
]);
export type PeerSettingsWorkspaceUpdate = typeof PeerSettingsWorkspaceUpdate.Type;

/** A secret was removed, or something still uses it (409 `secret_in_use`) and `force` is needed. */
export const PeerSettingsDeleteSecretResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("deleted") }),
  Schema.Struct({ kind: Schema.Literal("in-use"), usedBy: Schema.Array(Text) }),
]);
export type PeerSettingsDeleteSecretResult = typeof PeerSettingsDeleteSecretResult.Type;

/** Per workspace, what the status says without a request: the revision and who needs to decide. */
export const PeerSettingsStatus = Schema.Struct({
  workspaces: Schema.Array(
    Schema.Struct({
      workspace: Text,
      revision: Seq,
      /** Pending proposals the signed-in person may save or decline. */
      pendingProposals: Count,
    }),
  ),
});
export type PeerSettingsStatus = typeof PeerSettingsStatus.Type;

// The narrow parts of the document the app reads. They keep every key they do not name, at every
// level, so a value edited from one and sent back whole loses nothing a newer Hub added.
const keeping = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
const TextMap = Schema.Record(Schema.String, Schema.String);

/** `people.<email>`: a name and the plans the person declared (information; never credentials). */
export const PeerSettingsPersonEntry = keeping({
  name: Schema.optional(Text),
  personal: Schema.optional(Schema.Array(keeping({ harness: Text, plan: Text }))),
});
export type PeerSettingsPersonEntry = typeof PeerSettingsPersonEntry.Type;

/** `projects.<id>`. `capacity.personal` is any, commercial or none; a policy is notify, coordinate, ask or exclusive. */
export const PeerSettingsProject = keeping({
  name: Text,
  description: Schema.optional(Text),
  client: Schema.optional(Text),
  /** Addresses, or `["*"]` for the whole workspace. */
  members: Schema.Array(Text),
  leads: Schema.Array(Text),
  areas: Schema.optional(Schema.Array(Text)),
  repositories: Schema.Array(keeping({ id: Text, url: Text, branch: Text })),
  /** A tool's id, or the id with the project's own environment. */
  tools: Schema.Array(Schema.Union([Text, keeping({ tool: Text, env: Schema.optional(TextMap) })])),
  knowledge: keeping({ kontext: Schema.Boolean, company: Schema.Boolean }),
  capacity: keeping({
    personal: Text,
    shared: Schema.optional(
      keeping({
        pool: Text,
        budget: keeping({ amount: Schema.Number, period: Schema.optional(Text) }),
        allocations: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
        defaultAllocation: Schema.optional(Schema.Number),
        models: Schema.optional(Schema.Array(Text)),
        use: Schema.optional(Schema.Array(Text)),
      }),
    ),
  }),
  coordination: Schema.optional(
    keeping({ policy: Text, paths: Schema.optional(Schema.Record(Schema.String, Text)) }),
  ),
});
export type PeerSettingsProject = typeof PeerSettingsProject.Type;

/** `tools.<id>`: an MCP server, remote (`url`, `headers`) or local (`command`, `args`, `env`). */
export const PeerSettingsTool = keeping({
  name: Text,
  description: Schema.optional(Text),
  mcp: keeping({
    transport: Schema.optional(Text),
    url: Schema.optional(Text),
    headers: Schema.optional(TextMap),
    command: Schema.optional(Text),
    args: Schema.optional(Schema.Array(Text)),
    env: Schema.optional(TextMap),
  }),
  requires: Schema.optional(
    Schema.Array(
      keeping({ command: Text, install: Schema.optional(Text), docs: Schema.optional(Text) }),
    ),
  ),
});
export type PeerSettingsTool = typeof PeerSettingsTool.Type;

/** `capacity.<id>`: a pool of models behind the workspace's gateway. */
export const PeerSettingsPool = keeping({
  name: Text,
  description: Schema.optional(Text),
  models: Schema.Array(
    keeping({
      id: Text,
      provider: Text,
      upstream: Schema.optional(Text),
      harness: Schema.Array(Text),
      apiBase: Schema.optional(Text),
      credentialEnv: Schema.optional(Text),
    }),
  ),
});
export type PeerSettingsPool = typeof PeerSettingsPool.Type;

/** `webhooks.<id>`: `url` and `signingSecret` name workspace secrets (`${secret:NAME}`), never hold them. */
export const PeerSettingsWebhook = keeping({
  format: Text,
  url: Text,
  events: Schema.Array(Text),
  projects: Schema.optional(Schema.Array(Text)),
  signingSecret: Schema.optional(Schema.Array(Text)),
  enabled: Schema.Boolean,
});
export type PeerSettingsWebhook = typeof PeerSettingsWebhook.Type;

// Inputs. Every one names its workspace; a save names the revision it started from.
const Workspace = TrimmedNonEmptyString;
const Message = Schema.String.check(Schema.isMaxLength(300));
const Paths = Schema.Array(PeerSettingsPath);
/** How a conflict is settled: `force` takes my value, `drop` keeps theirs. */
const Settling = { force: Schema.optional(Paths), drop: Schema.optional(Paths) };

export const PeerSettingsGetInput = Schema.Struct({
  workspace: Workspace,
  /** The revision the caller knows of; a newer one reads the view again (the Hub ignores it). */
  revision: Schema.optional(Seq),
});
export type PeerSettingsGetInput = typeof PeerSettingsGetInput.Type;

export const PeerSettingsChangeInput = Schema.Struct({
  workspace: Workspace,
  /** The revision the draft started from. */
  base: Seq,
  set: Schema.Array(PeerSettingsSet).check(Schema.isMaxLength(200)),
  /** The reason; it becomes the commit's subject. */
  message: Schema.optional(Message),
  ...Settling,
});
export type PeerSettingsChangeInput = typeof PeerSettingsChangeInput.Type;

export const PeerSettingsHistoryInput = Schema.Struct({
  workspace: Workspace,
  /** `workspace`, `project:<id>` or `person:<email>`. */
  scope: Schema.optional(TrimmedNonEmptyString),
  before: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 50 })),
  ),
  /** The revision the caller knows of; a newer one reads the page again (the Hub ignores it). */
  revision: Schema.optional(Seq),
});
export type PeerSettingsHistoryInput = typeof PeerSettingsHistoryInput.Type;

export const PeerSettingsHistoryEntryInput = Schema.Struct({
  workspace: Workspace,
  seq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type PeerSettingsHistoryEntryInput = typeof PeerSettingsHistoryEntryInput.Type;

export const PeerSettingsRevertInput = Schema.Struct({
  ...PeerSettingsHistoryEntryInput.fields,
  message: Schema.optional(Message),
  dryRun: Schema.optional(Schema.Boolean),
  ...Settling,
});
export type PeerSettingsRevertInput = typeof PeerSettingsRevertInput.Type;

/**
 * YAML files to import, as `exportYaml` gives them (file path → text, `.peer-revision` included):
 * the app turns them into the Hub's bundle. Without `base`, `.peer-revision` names it; without
 * either, the files overwrite the head and every difference is listed.
 */
export const PeerSettingsImportInput = Schema.Struct({
  workspace: Workspace,
  files: Schema.Record(Schema.String, Schema.String),
  base: Schema.optional(Seq),
  message: Schema.optional(Message),
  dryRun: Schema.optional(Schema.Boolean),
  ...Settling,
});
export type PeerSettingsImportInput = typeof PeerSettingsImportInput.Type;

export const PeerSettingsWorkspaceInput = Schema.Struct({ workspace: Workspace });
export type PeerSettingsWorkspaceInput = typeof PeerSettingsWorkspaceInput.Type;

export const PeerSettingsProposalsInput = Schema.Struct({
  workspace: Workspace,
  /** Pending, applied, declined, withdrawn or expired; every proposal without it. */
  state: Schema.optional(TrimmedNonEmptyString),
  /** The pending count the caller knows of; another one reads the list again (the Hub ignores it). */
  waiting: Schema.optional(Count),
});
export type PeerSettingsProposalsInput = typeof PeerSettingsProposalsInput.Type;

export const PeerSettingsProposeInput = Schema.Struct({
  workspace: Workspace,
  base: Seq,
  set: Schema.Array(PeerSettingsSet).check(Schema.isMaxLength(200)),
  /** Why: one line, required. */
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(300)),
  /** What the person asked. */
  instruction: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  via: Schema.optional(
    Schema.Struct({
      kind: Schema.Literal("agent"),
      agent: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
      thread: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
    }),
  ),
  /** What an ask without changes is about, such as `project:booking`. */
  scope: Schema.optional(TrimmedNonEmptyString),
});
export type PeerSettingsProposeInput = typeof PeerSettingsProposeInput.Type;

export const PeerSettingsProposalInput = Schema.Struct({
  workspace: Workspace,
  id: TrimmedNonEmptyString,
});
export type PeerSettingsProposalInput = typeof PeerSettingsProposalInput.Type;

export const PeerSettingsApplyProposalInput = Schema.Struct({
  ...PeerSettingsProposalInput.fields,
  message: Schema.optional(Message),
  dryRun: Schema.optional(Schema.Boolean),
  ...Settling,
});
export type PeerSettingsApplyProposalInput = typeof PeerSettingsApplyProposalInput.Type;

export const PeerSettingsDeclineProposalInput = Schema.Struct({
  ...PeerSettingsProposalInput.fields,
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
});
export type PeerSettingsDeclineProposalInput = typeof PeerSettingsDeclineProposalInput.Type;

/** A workspace secret's name: letters, digits, `-` and `_`, up to 64 characters. */
const SecretName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));

export const PeerSettingsPutSecretInput = Schema.Struct({
  workspace: Workspace,
  name: SecretName,
  value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192)),
});
export type PeerSettingsPutSecretInput = typeof PeerSettingsPutSecretInput.Type;

export const PeerSettingsDeleteSecretInput = Schema.Struct({
  workspace: Workspace,
  name: SecretName,
  /** Remove it although something still uses it. */
  force: Schema.optional(Schema.Boolean),
});
export type PeerSettingsDeleteSecretInput = typeof PeerSettingsDeleteSecretInput.Type;

export const PeerSettingsGitHubEnableInput = Schema.Struct({
  workspace: Workspace,
  /** Generate a new secret although one exists. */
  rotate: Schema.optional(Schema.Boolean),
});
export type PeerSettingsGitHubEnableInput = typeof PeerSettingsGitHubEnableInput.Type;

export const PeerSettingsGitHubDisableInput = Schema.Struct({
  workspace: Workspace,
  /** List what removing it deletes, without removing it. */
  dryRun: Schema.optional(Schema.Boolean),
});
export type PeerSettingsGitHubDisableInput = typeof PeerSettingsGitHubDisableInput.Type;

export const PeerSettingsDomainInput = Schema.Struct({
  workspace: Workspace,
  domain: TrimmedNonEmptyString.check(Schema.isMaxLength(253)),
});
export type PeerSettingsDomainInput = typeof PeerSettingsDomainInput.Type;

export const PeerSettingsUpdateWorkspaceInput = Schema.Struct({
  workspace: Workspace,
  name: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  allowedDomains: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(253))),
  ),
});
export type PeerSettingsUpdateWorkspaceInput = typeof PeerSettingsUpdateWorkspaceInput.Type;
