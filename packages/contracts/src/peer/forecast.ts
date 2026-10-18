import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const PeerForecastSource = Schema.Literals(["live", "shared", "pushed"]);
export type PeerForecastSource = typeof PeerForecastSource.Type;
/** The longest check output a pair carries. */
export const PEER_FORECAST_CHECK_OUTPUT_MAX = 600;
/** The longest check command a computer keeps. */
export const PEER_FORECAST_CHECK_COMMAND_MAX = 200;
/**
 * The result of the command set on this computer, run on a clean merge in a throwaway change. It is
 * advice: it never stops a step.
 */
export const PeerForecastCheck = Schema.Struct({
  state: Schema.Literals(["passed", "fails", "timedOut", "couldNotRead"]),
  /** The first characters of the failing output; teammate text, so fenced when an agent reads it. */
  output: Schema.optional(Schema.String.check(Schema.isMaxLength(PEER_FORECAST_CHECK_OUTPUT_MAX))),
  at: Schema.String,
  /** The commits it ran on, one per side. */
  commits: Schema.Array(Schema.String).check(Schema.isMaxLength(2)),
});
export type PeerForecastCheck = typeof PeerForecastCheck.Type;
/** The longest excerpt of one side's text in a conflict's first hunk. */
export const PEER_FORECAST_LINES_MAX = 400;
export const PeerForecastSide = Schema.Struct({
  branch: Schema.String,
  email: Schema.String,
  task: Schema.optional(Schema.String),
  title: Schema.String,
  where: Schema.Literals(["here", "origin"]),
  /**
   * Where a Jujutsu checkout read this side: an agent's working copy on this computer (`live`), a
   * teammate's shared work in progress (`shared`) or a pushed bookmark (`pushed`). Absent in a Git
   * checkout and from an older Peer.
   */
  source: Schema.optional(PeerForecastSource),
  /** When that source was read. */
  readAt: Schema.optional(Schema.String),
  /** The side's jj change id, when the repository knows its commit. */
  changeId: Schema.optional(Schema.String),
  /** The agent that works on this side, from its thread, when known. */
  agent: Schema.optional(Schema.String),
});
export type PeerForecastSide = typeof PeerForecastSide.Type;
export const PeerForecastPair = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  repository: Schema.String,
  a: PeerForecastSide,
  b: PeerForecastSide,
  files: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  more: count,
  checkedAt: Schema.String,
  /** Present when a check command is set and this pair merges clean in a Jujutsu checkout. */
  check: Schema.optional(PeerForecastCheck),
  /**
   * One side builds on another change in flight and meets that change's conflict instead of adding
   * its own: `side` is the stacked one, `branch` and `task` name the change it builds on.
   */
  inheritedFrom: Schema.optional(
    Schema.Struct({
      side: Schema.Literals(["a", "b"]),
      branch: Schema.String,
      task: Schema.optional(Schema.String),
    }),
  ),
  /**
   * The side whose change was started later (jj keeps that time as the change's author time). Its
   * person resolves a conflict or builds on the other side, so the card's actions go to that side.
   * Absent in a Git checkout and from an older Peer.
   */
  later: Schema.optional(Schema.Literals(["a", "b"])),
  /**
   * The first conflicting hunk of a conflict: each side's text, at most 400 characters. Teammate
   * text, so fenced when an agent reads it.
   */
  lines: Schema.optional(
    Schema.Struct({
      file: Schema.String,
      a: Schema.String.check(Schema.isMaxLength(PEER_FORECAST_LINES_MAX)),
      b: Schema.String.check(Schema.isMaxLength(PEER_FORECAST_LINES_MAX)),
    }),
  ),
});
export type PeerForecastPair = typeof PeerForecastPair.Type;
const PeerForecastCheckCommand = Schema.String.check(
  Schema.isMaxLength(PEER_FORECAST_CHECK_COMMAND_MAX),
);
export const PeerForecast = Schema.Struct({
  state: Schema.Literals(["on", "off", "unsupported"]),
  reason: Schema.optional(
    Schema.Literals(["disabled", "environment", "git-missing", "git-old", "git-unreadable"]),
  ),
  git: Schema.optional(Schema.String),
  teammates: Schema.Boolean,
  pairs: Schema.Array(PeerForecastPair).check(Schema.isMaxLength(30)),
  tracked: count,
  skipped: count,
  notOnOrigin: count,
  paused: Schema.Array(Schema.Struct({ repository: Schema.String, until: Schema.String })),
  fetchFailedAt: Schema.optional(Schema.String),
  checkedAt: Schema.optional(Schema.String),
  /** This computer's choices, so Settings shows them; absent from an older Peer. */
  shareWip: Schema.optional(Schema.Boolean),
  check: Schema.optional(PeerForecastCheckCommand),
});
export type PeerForecast = typeof PeerForecast.Type;
export const PeerForecastConfigure = Schema.Struct({
  teammates: Schema.optional(Schema.Boolean),
  /** Push each agent's work in progress to `refs/peer/wip/*` on origin. Off by default. */
  shareWip: Schema.optional(Schema.Boolean),
  /** The command run on each clean merge; empty turns checks off. */
  check: Schema.optional(PeerForecastCheckCommand),
});
export type PeerForecastConfigure = typeof PeerForecastConfigure.Type;
/** Preserve complete paths and count omitted paths; unusually large labels may omit a pair. */
export function boundForecast(source: PeerForecast): PeerForecast {
  const pairs = source.pairs.slice(0, 30).map((pair) => ({
    ...pair,
    files: pair.files.slice(0, 20),
    more: pair.more + Math.max(0, pair.files.length - 20),
    ...(pair.lines === undefined
      ? {}
      : {
          lines: {
            file: pair.lines.file,
            a: pair.lines.a.slice(0, PEER_FORECAST_LINES_MAX),
            b: pair.lines.b.slice(0, PEER_FORECAST_LINES_MAX),
          },
        }),
    ...(pair.check?.output === undefined
      ? {}
      : {
          check: {
            ...pair.check,
            output: pair.check.output.slice(0, PEER_FORECAST_CHECK_OUTPUT_MAX),
          },
        }),
  }));
  const result = { ...source, pairs },
    encoder = new TextEncoder();
  while (encoder.encode(JSON.stringify(result)).length >= 64 * 1024 && pairs.length > 0) {
    const pair = pairs.findLast((candidate) => candidate.files.length > 0);
    if (pair === undefined) pairs.pop();
    else {
      pair.files.pop();
      pair.more++;
    }
  }
  return result;
}
export const PEER_FORECAST_METHODS = {
  peerForecastSubscribe: "peerForecast.subscribe",
  peerForecastConfigure: "peerForecast.configure",
} as const;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const WsPeerForecastRpcGroup = RpcGroup.make(
  Rpc.make(PEER_FORECAST_METHODS.peerForecastSubscribe, {
    payload: Schema.Struct({}),
    success: PeerForecast,
    error,
    stream: true,
  }),
  Rpc.make(PEER_FORECAST_METHODS.peerForecastConfigure, {
    payload: PeerForecastConfigure,
    success: PeerForecast,
    error,
  }),
);
export const ForecastRpcScopes = {
  [PEER_FORECAST_METHODS.peerForecastSubscribe]: AuthOrchestrationReadScope,
  [PEER_FORECAST_METHODS.peerForecastConfigure]: AuthAccessWriteScope,
} as const satisfies Record<
  RpcGroup.Rpcs<typeof WsPeerForecastRpcGroup>["_tag"],
  AuthEnvironmentScope
>;
