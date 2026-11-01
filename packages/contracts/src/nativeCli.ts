import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const NativeCliToolStatus = Schema.Literals(["completed", "failed", "incomplete"]);
export type NativeCliToolStatus = typeof NativeCliToolStatus.Type;

const NativeCliEntryId = Schema.NullOr(TrimmedNonEmptyString);

/** One thing an agent did in a turn it ran in its own CLI, in the order it happened. */
export const NativeCliEntry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("assistant_text"),
    nativeId: NativeCliEntryId,
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    nativeId: NativeCliEntryId,
    command: Schema.String,
    output: Schema.optional(Schema.String),
    exitCode: Schema.optional(Schema.Int),
    status: NativeCliToolStatus,
  }),
  Schema.Struct({
    type: Schema.Literal("file_change"),
    nativeId: NativeCliEntryId,
    path: TrimmedNonEmptyString,
    oldText: Schema.optional(Schema.String),
    newText: Schema.optional(Schema.String),
    status: NativeCliToolStatus,
  }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    nativeId: NativeCliEntryId,
    name: Schema.NullOr(TrimmedNonEmptyString),
    title: Schema.String,
    input: Schema.Unknown,
    output: Schema.optional(Schema.Unknown),
    status: NativeCliToolStatus,
  }),
]);
export type NativeCliEntry = typeof NativeCliEntry.Type;

/** A prompt a person sent in the agent's own CLI and what the agent did with it. */
export const NativeCliTurn = Schema.Struct({
  nativeMessageId: TrimmedNonEmptyString,
  text: Schema.String,
  entries: Schema.Array(NativeCliEntry),
});
export type NativeCliTurn = typeof NativeCliTurn.Type;

/**
 * What a loan's end could not bring back: `compacted` turns before a compaction, `diverged` the
 * position is gone, `unread` the read failed, `truncated` too long to import whole.
 */
export const NativeCliGap = Schema.Literals([
  "none",
  "compacted",
  "diverged",
  "unread",
  "truncated",
]);
export type NativeCliGap = typeof NativeCliGap.Type;

/**
 * A thread's native session lent to its agent's own CLI. Two processes on one session each keep
 * their own memory and branch the transcript, so the thread runs nothing until the loan ends.
 */
export const OrchestrationV2CliLoan = Schema.Struct({
  terminalId: TrimmedNonEmptyString,
  /** The session's last prompt when the loan began; null for a session with none. */
  afterNativeMessageId: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: Schema.DateTimeUtc,
});
export type OrchestrationV2CliLoan = typeof OrchestrationV2CliLoan.Type;

export const OrchestrationV2CliLoanJson = OrchestrationV2CliLoan.mapFields((fields) => ({
  ...fields,
  startedAt: Schema.DateTimeUtcFromString,
}));
export type OrchestrationV2CliLoanJson = typeof OrchestrationV2CliLoanJson.Type;

export const NativeCliInput = Schema.Struct({ threadId: ThreadId });
export type NativeCliInput = typeof NativeCliInput.Type;

/**
 * What a client needs to open the terminal: `terminal.open` with the thread's id and this
 * `terminalId`, `cwd` and `providerInstanceId`, then write `command` and a newline to it. The server
 * resolves the instance's environment itself, so its secrets never cross the wire. The loan is tied
 * to this terminal id, so another id leaves the thread out in the CLI with nothing watching it.
 */
export const NativeCliTerminalLaunch = Schema.Struct({
  terminalId: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
});
export type NativeCliTerminalLaunch = typeof NativeCliTerminalLaunch.Type;

export const NativeCliOperationErrorReason = Schema.Literals([
  /** The agent or this thread cannot go to a CLI at all. The message says why. */
  "unavailable",
  "out_in_cli",
  "run_active",
  "rolled_back",
  "terminal_busy",
  "adapter_failed",
  "read_failed",
  /** Another client of the agent still holds the session, which is not Peer's to end. */
  "session_in_use",
  "detach_failed",
  "changed",
]);
export type NativeCliOperationErrorReason = typeof NativeCliOperationErrorReason.Type;

export class NativeCliOperationError extends Schema.TaggedError<NativeCliOperationError>()(
  "NativeCliOperationError",
  {
    threadId: ThreadId,
    reason: NativeCliOperationErrorReason,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
