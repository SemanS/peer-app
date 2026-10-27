import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const ids = Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([])));

export const PeerMcpStatus = Schema.Struct({
  enabled: Schema.Boolean,
  command: Schema.String,
  /** Local agents in a herdr pane bound over MCP (kept for older clients). */
  agents: Schema.Array(Schema.String),
  /** Ids of the editors connected at user scope on this computer. */
  clients: ids,
  /** Ids of the sessions bound over MCP (`<agent>:<native id>`). */
  sessions: ids,
});
export type PeerMcpStatus = typeof PeerMcpStatus.Type;

export const PeerMcpScope = Schema.Literals(["user", "project"]);
export type PeerMcpScope = typeof PeerMcpScope.Type;

export const PeerMcpPlace = Schema.Struct({
  path: Schema.String,
  connected: Schema.Boolean,
});
export type PeerMcpPlace = typeof PeerMcpPlace.Type;

export const PeerMcpClient = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  installed: Schema.Boolean,
  /** Absent when the client keeps no user-wide file. */
  user: Schema.optional(PeerMcpPlace),
  /** Present when a project was named and the client reads a per-project file. */
  project: Schema.optional(PeerMcpPlace),
});
export type PeerMcpClient = typeof PeerMcpClient.Type;

/** A project names a workspace project, whose checkout on this computer holds the file. */
export const PeerMcpProjectInput = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
});
export type PeerMcpProjectInput = typeof PeerMcpProjectInput.Type;

export const PeerMcpClientsInput = Schema.Struct({
  project: Schema.optional(PeerMcpProjectInput),
});
export type PeerMcpClientsInput = typeof PeerMcpClientsInput.Type;

export const PeerMcpClientList = Schema.Struct({
  clients: Schema.Array(PeerMcpClient),
});
export type PeerMcpClientList = typeof PeerMcpClientList.Type;

export const PeerMcpConnectInput = Schema.Struct({
  client: Schema.String,
  scope: PeerMcpScope,
  project: Schema.optional(PeerMcpProjectInput),
});
export type PeerMcpConnectInput = typeof PeerMcpConnectInput.Type;

export const PeerMcpConnectResult = Schema.Struct({
  client: Schema.String,
  scope: PeerMcpScope,
  path: Schema.String,
  /** `written`, `unchanged`, or `manual`: the file is not plain JSON, so it was left alone. */
  outcome: Schema.Literals(["written", "unchanged", "manual"]),
  /** The `peer` entry as its file holds it, for pasting by hand. */
  entry: Schema.String,
});
export type PeerMcpConnectResult = typeof PeerMcpConnectResult.Type;
