import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Peer's settings plugin: workspace and project settings changed in the app (the Hub's `settings`
 * feature). Everything here mirrors the Hub's wire contract field for field (camelCase, times as
 * RFC 3339 strings, a `path` an array of strings). Names of open vocabularies (a line's scope kind,
 * when a change applies, a diagnostic's severity) are plain strings, so an app of one age reads a
 * Hub of another; the values known today are listed beside them.
 */
export const PEER_SETTINGS_PLUGIN = {
  id: "settings",
  title: "Workspace settings",
  summary: "Change workspace and project settings in the app, or through your agent.",
  hubFeature: { id: "settings", revision: 1 },
  commandNames: ["config"],
} as const;

const Role = Schema.Literals(["owner", "admin", "member"]);
const Text = Schema.String;
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
/** A revision number, as the Hub counts them: 1 is the first. */
const Seq = Count;
const NullableText = Schema.optional(Schema.NullOr(Schema.String));

/** A person as the Hub names them in lines and revisions. */
export const PeerSettingsPerson = Schema.Struct({ email: Text, name: Text });
export type PeerSettingsPerson = typeof PeerSettingsPerson.Type;

/** A node of the settings document: `["projects","booking","name"]`. */
export const PeerSettingsPath = Schema.Array(Text);
export type PeerSettingsPath = typeof PeerSettingsPath.Type;

/** One value to set; `null` removes the node. */
export const PeerSettingsSet = Schema.Struct({ path: PeerSettingsPath, value: Schema.Unknown });
export type PeerSettingsSet = typeof PeerSettingsSet.Type;

/** What a line is about: `kind` is `workspace` (no `id`), `project` or `person`. */
export const PeerSettingsScope = Schema.Struct({
  kind: Text,
  id: Schema.optional(Text),
  name: Text,
});
export type PeerSettingsScope = typeof PeerSettingsScope.Type;

/**
 * One change in words (`Booking · Name: Booking → Bookings`), as the Hub writes it. A line that says
 * one thing has no `from` (`Booking · Project: created`).
 */
export const PeerSettingsLine = Schema.Struct({
  path: PeerSettingsPath,
  scope: PeerSettingsScope,
  label: Text,
  from: Schema.optional(Text),
  to: Text,
});
export type PeerSettingsLine = typeof PeerSettingsLine.Type;

/** A line's change: `Booking → Bookings`, or `created` for a line that says one thing. */
export const settingsLineChange = (line: Pick<PeerSettingsLine, "from" | "to">): string =>
  line.from === undefined ? line.to : `${line.from} → ${line.to}`;

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

/** When a kind of change takes effect; `kind` is after-approval, on-sync, clone or now. */
export const PeerSettingsApplies = Schema.Struct({ kind: Text, text: Text });
export type PeerSettingsApplies = typeof PeerSettingsApplies.Type;

/** The head a change was made against. */
export const PeerSettingsHead = Schema.Struct({
  seq: Seq,
  by: PeerSettingsPerson,
  at: Text,
});
export type PeerSettingsHead = typeof PeerSettingsHead.Type;

/** A revision as `GET /settings` names the latest one; `message` is its reason, null when none was given. */
export const PeerSettingsRevision = Schema.Struct({
  seq: Seq,
  commit: Text,
  at: Text,
  by: PeerSettingsPerson,
  message: NullableText,
});
export type PeerSettingsRevision = typeof PeerSettingsRevision.Type;

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

/** A change after it was saved: the preview it made, then the revision it became. */
export const PeerSettingsSaved = Schema.Struct({
  ...PeerSettingsPreview.fields,
  revision: Schema.optional(Schema.Struct({ seq: Seq, commit: Text, at: Text })),
  audit: Schema.optional(Text),
});
export type PeerSettingsSaved = typeof PeerSettingsSaved.Type;

/**
 * What a change comes to, as the app answers it. A dry run is a `preview`, a save is `saved`. The Hub's refusals are results too, not
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

/** A secret's name, and when it was last stored and by whom. */
export const PeerSettingsSecretsView = Schema.Struct({
  secrets: Schema.Array(
    Schema.Struct({
      name: Text,
      at: NullableText,
      by: Schema.optional(Schema.NullOr(PeerSettingsPerson)),
    }),
  ),
});
export type PeerSettingsSecretsView = typeof PeerSettingsSecretsView.Type;

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

/** Per workspace, what the status says without a request: its revision. */
export const PeerSettingsStatus = Schema.Struct({
  workspaces: Schema.Array(Schema.Struct({ workspace: Text, revision: Seq })),
});
export type PeerSettingsStatus = typeof PeerSettingsStatus.Type;

// The narrow parts of the document the app reads. They keep every key they do not name, at every
// level, so a value edited from one and sent back whole loses nothing a newer Hub added.
const keeping = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
const TextMap = Schema.Record(Schema.String, Schema.String);

/** `people.<email>`: a name. */
export const PeerSettingsPersonEntry = keeping({ name: Schema.optional(Text) });
export type PeerSettingsPersonEntry = typeof PeerSettingsPersonEntry.Type;

/** `projects.<id>`. */
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
  /** The agent that saves for the person: the commit names it beside the person, its author. */
  via: Schema.optional(
    Schema.Struct({
      kind: Schema.Literal("agent"),
      agent: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
    }),
  ),
  ...Settling,
});
export type PeerSettingsChangeInput = typeof PeerSettingsChangeInput.Type;

export const PeerSettingsWorkspaceInput = Schema.Struct({ workspace: Workspace });
export type PeerSettingsWorkspaceInput = typeof PeerSettingsWorkspaceInput.Type;

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
});
export type PeerSettingsDeleteSecretInput = typeof PeerSettingsDeleteSecretInput.Type;

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
