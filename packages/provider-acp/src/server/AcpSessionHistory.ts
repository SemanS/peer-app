import type { NativeCliEntry, NativeCliGap, NativeCliTurn } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/compat";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

// A replay is copied into one orchestration command, its events and its projections, so a session
// the CLI worked on for hours must not become one huge row. A field stops where the wire projection
// would clip it anyway (`MAX_DETAIL_STRING_BYTES` in `WireProjection.ts`). A turn's text lands twice,
// as a message and as an item, so 4 MiB keeps the import under the 8 MiB a live stream may send.
// Near that budget a field keeps only a short excerpt, so a long CLI session still shows most steps
// it took; what does not fit even then is dropped and reported as a `truncated` gap. Each entry
// becomes its own events in one transaction, which the entry limit bounds where small entries would
// never reach the bytes.
const MAX_FIELD_CHARS = 32_768;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ENTRIES = 5_000;
const MIN_FIELD_CHARS = 512;
/** Full fields leave this much, or every step after them would lose its excerpt too. */
const EXCERPT_RESERVE_BYTES = 1024 * 1024;

/** `claude-agent-acp` replays the summary `/compact` wrote as if a person had sent it. */
const COMPACTION_SUMMARY_PREFIX = "This session is being continued from a previous conversation";

const DEFAULT_READ_TIMEOUT = Duration.seconds(30);
const CLOSE_TIMEOUT = Duration.seconds(2);
const PROCESS_TERMINATION_GRACE = Duration.millis(250);

export interface AcpSessionHistory {
  readonly turns: ReadonlyArray<NativeCliTurn>;
  readonly compacted: boolean;
}

export interface AcpSessionTurnsAfter {
  readonly turns: ReadonlyArray<NativeCliTurn>;
  readonly gap: Exclude<NativeCliGap, "unread">;
}

interface TextSlot {
  readonly type: "text";
  readonly messageId: string;
  text: string;
}

interface ToolSlot {
  readonly type: "tool";
  readonly toolCallId: string;
  name?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ReadonlyArray<EffectAcpSchema.ToolCallContent>;
  exitCode?: number;
}

interface TurnDraft {
  readonly nativeMessageId: string;
  text: string;
  readonly slots: Array<TextSlot | ToolSlot>;
}

type ToolUpdate = Extract<
  EffectAcpSchema.SessionUpdate,
  { readonly sessionUpdate: "tool_call" | "tool_call_update" }
>;

const clipText = (text: string, limit: number): string =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n… [${text.length - limit} more characters not imported]`;

const clipValue = (value: unknown, limit: number): unknown => {
  if (value === undefined || value === null) return value;
  const serialized = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return serialized.length <= limit ? value : clipText(serialized, limit);
};

const blockText = (block: EffectAcpSchema.ContentBlock): string =>
  block.type === "text" ? block.text : "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function terminalExitCode(meta: ToolUpdate["_meta"]): number | undefined {
  const exit = isRecord(meta) ? meta.terminal_exit : undefined;
  const code = isRecord(exit) ? exit.exit_code : undefined;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

function applyToolUpdate(slot: ToolSlot, update: ToolUpdate): void {
  // ACP v1 leaves a field that an update omits or nulls as it was.
  if (typeof update.name === "string") slot.name = update.name;
  if (typeof update.title === "string") slot.title = update.title;
  if (typeof update.kind === "string") slot.kind = update.kind;
  if (typeof update.status === "string") slot.status = update.status;
  if (update.rawInput !== undefined && update.rawInput !== null) slot.rawInput = update.rawInput;
  if (update.rawOutput !== undefined && update.rawOutput !== null) {
    slot.rawOutput = update.rawOutput;
  }
  if (update.content !== undefined && update.content !== null) slot.content = update.content;
  const exitCode = terminalExitCode(update._meta);
  if (exitCode !== undefined) slot.exitCode = exitCode;
}

function toolStatus(status: string | undefined): "completed" | "failed" | "incomplete" {
  return status === "completed" || status === "failed" ? status : "incomplete";
}

function commandLine(slot: ToolSlot): string {
  const command = isRecord(slot.rawInput) ? slot.rawInput.command : undefined;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) return command.join(" ");
  return slot.title ?? slot.name ?? "";
}

function commandOutput(slot: ToolSlot): string | undefined {
  const raw = slot.rawOutput;
  if (typeof raw === "string") return raw;
  if (isRecord(raw)) {
    for (const key of ["stdout", "output", "aggregated_output", "formatted_output"]) {
      const value = raw[key];
      if (typeof value === "string") return value;
    }
  }
  const text = (slot.content ?? [])
    .flatMap((item) => (item.type === "content" ? [blockText(item.content)] : []))
    .join("");
  return text.length > 0 ? text : undefined;
}

function toolEntries(slot: ToolSlot): ReadonlyArray<NativeCliEntry> {
  const status = toolStatus(slot.status);
  const nativeId = slot.toolCallId;
  if (slot.kind === "execute") {
    const output = commandOutput(slot);
    return [
      {
        type: "command",
        nativeId,
        command: clipText(commandLine(slot), MAX_FIELD_CHARS),
        ...(output === undefined ? {} : { output: clipText(output, MAX_FIELD_CHARS) }),
        ...(slot.exitCode === undefined ? {} : { exitCode: slot.exitCode }),
        status,
      },
    ];
  }
  if (slot.kind === "edit") {
    const changes = (slot.content ?? []).flatMap((item) =>
      item.type === "diff" && "path" in item && item.path.trim().length > 0
        ? [
            {
              type: "file_change" as const,
              nativeId,
              path: item.path,
              ...(typeof item.oldText === "string"
                ? { oldText: clipText(item.oldText, MAX_FIELD_CHARS) }
                : {}),
              newText: clipText(item.newText, MAX_FIELD_CHARS),
              status,
            },
          ]
        : [],
    );
    if (changes.length > 0) return changes;
  }
  const output = clipValue(slot.rawOutput, MAX_FIELD_CHARS);
  return [
    {
      type: "tool",
      nativeId,
      name: slot.name?.trim() || null,
      title: clipText(slot.title ?? slot.name ?? "", MAX_FIELD_CHARS),
      input: clipValue(slot.rawInput ?? null, MAX_FIELD_CHARS),
      ...(output === undefined ? {} : { output }),
      status,
    },
  ];
}

/** One message can come back split around its tools, and a tool can touch several files. */
function withUniqueNativeIds(
  entries: ReadonlyArray<NativeCliEntry>,
): ReadonlyArray<NativeCliEntry> {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    if (entry.nativeId === null) return entry;
    const count = seen.get(entry.nativeId) ?? 0;
    seen.set(entry.nativeId, count + 1);
    return count === 0 ? entry : { ...entry, nativeId: `${entry.nativeId}#${count}` };
  });
}

function finishTurn(turn: TurnDraft): NativeCliTurn {
  return {
    nativeMessageId: turn.nativeMessageId,
    text: clipText(turn.text, MAX_FIELD_CHARS),
    entries: withUniqueNativeIds(
      turn.slots.flatMap((slot) =>
        slot.type === "tool"
          ? toolEntries(slot)
          : [
              {
                type: "assistant_text" as const,
                nativeId: slot.messageId,
                text: clipText(slot.text, MAX_FIELD_CHARS),
              },
            ],
      ),
    ),
  };
}

/**
 * Folds the `session/update` payloads of a `session/load` into finished turns. Only a user message
 * can later anchor a position, so turns are keyed by theirs.
 */
export function foldAcpSessionReplay(
  updates: ReadonlyArray<EffectAcpSchema.SessionUpdate>,
): AcpSessionHistory {
  const turns: Array<TurnDraft> = [];
  const toolsById = new Map<string, ToolSlot>();
  let currentTurn: TurnDraft | undefined;
  let compacted = false;
  let summaryMessageId: string | undefined;

  for (const update of updates) {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const messageId = update.messageId;
        if (!messageId) break;
        const text = blockText(update.content);
        if (messageId === summaryMessageId) break;
        if (messageId === currentTurn?.nativeMessageId) {
          currentTurn.text += text;
          break;
        }
        if (text.startsWith(COMPACTION_SUMMARY_PREFIX)) {
          // Whatever follows the summary until the next prompt was said before the compaction.
          compacted = true;
          summaryMessageId = messageId;
          currentTurn = undefined;
          break;
        }
        currentTurn = { nativeMessageId: messageId, text, slots: [] };
        turns.push(currentTurn);
        break;
      }
      case "agent_message_chunk": {
        // Codex appends notes of its own, such as a model warning, with no message id.
        if (!update.messageId || currentTurn === undefined) break;
        const last = currentTurn.slots.at(-1);
        if (last?.type === "text" && last.messageId === update.messageId) {
          last.text += blockText(update.content);
        } else {
          currentTurn.slots.push({
            type: "text",
            messageId: update.messageId,
            text: blockText(update.content),
          });
        }
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const known = toolsById.get(update.toolCallId);
        if (known !== undefined) {
          applyToolUpdate(known, update);
          break;
        }
        if (currentTurn === undefined) break;
        const slot: ToolSlot = { type: "tool", toolCallId: update.toolCallId };
        applyToolUpdate(slot, update);
        toolsById.set(update.toolCallId, slot);
        currentTurn.slots.push(slot);
        break;
      }
      default:
        break;
    }
  }

  return { turns: turns.map(finishTurn), compacted };
}

function shrinkEntry(entry: NativeCliEntry): NativeCliEntry {
  const limit = MIN_FIELD_CHARS;
  switch (entry.type) {
    case "assistant_text":
      return { ...entry, text: clipText(entry.text, limit) };
    case "command":
      return {
        ...entry,
        command: clipText(entry.command, limit),
        ...(entry.output === undefined ? {} : { output: clipText(entry.output, limit) }),
      };
    case "file_change":
      return {
        ...entry,
        ...(entry.oldText === undefined ? {} : { oldText: clipText(entry.oldText, limit) }),
        ...(entry.newText === undefined ? {} : { newText: clipText(entry.newText, limit) }),
      };
    case "tool":
      return {
        ...entry,
        input: clipValue(entry.input, limit),
        ...(entry.output === undefined ? {} : { output: clipValue(entry.output, limit) }),
      };
  }
}

/** The comma that joins it to its neighbour counts too. */
const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") + 1;

/** Earlier turns keep their detail: the budget runs out on the end of a long session. */
function withinImportBudget(turns: ReadonlyArray<NativeCliTurn>): {
  readonly turns: ReadonlyArray<NativeCliTurn>;
  readonly truncated: boolean;
} {
  let remainingBytes = MAX_IMPORT_BYTES;
  let remainingEntries = MAX_IMPORT_ENTRIES;
  let truncated = false;
  const fittingVariant = <A>(full: A, excerpt: A): A | undefined => {
    if (serializedBytes(full) <= remainingBytes - EXCERPT_RESERVE_BYTES) return full;
    return serializedBytes(excerpt) <= remainingBytes ? excerpt : undefined;
  };
  const kept: Array<NativeCliTurn> = [];
  for (const turn of turns) {
    const prompt = { ...turn, entries: [] };
    const fitted = fittingVariant(prompt, {
      ...prompt,
      text: clipText(turn.text, MIN_FIELD_CHARS),
    });
    if (fitted === undefined) return { turns: kept, truncated: true };
    remainingBytes -= serializedBytes(fitted);

    const entries: Array<NativeCliEntry> = [];
    for (const entry of turn.entries) {
      const fittedEntry =
        remainingEntries <= 0 ? undefined : fittingVariant(entry, shrinkEntry(entry));
      if (fittedEntry === undefined) {
        truncated = true;
        continue;
      }
      remainingBytes -= serializedBytes(fittedEntry);
      remainingEntries -= 1;
      entries.push(fittedEntry);
    }
    kept.push({ ...fitted, entries });
  }
  return { turns: kept, truncated };
}

/**
 * The turns that happened after a position in the session. With no position the session had no
 * prompt when the loan began, so a compaction is the only thing that can have lost any, and it may
 * as well be one made before the loan: the replay cannot tell them apart, and an unneeded note beats
 * a hidden loss. `truncated` wins because its rollback guard covers what `compacted` would need.
 */
export function turnsAfter(
  history: AcpSessionHistory,
  afterNativeMessageId: string | null,
): AcpSessionTurnsAfter {
  const anchor =
    afterNativeMessageId === null
      ? -1
      : history.turns.findLastIndex((turn) => turn.nativeMessageId === afterNativeMessageId);
  if (afterNativeMessageId !== null && anchor === -1 && !history.compacted) {
    return { turns: [], gap: "diverged" };
  }
  const budgeted = withinImportBudget(history.turns.slice(anchor + 1));
  const lostToCompaction = anchor === -1 && history.compacted;
  return {
    turns: budgeted.turns,
    gap: budgeted.truncated ? "truncated" : lostToCompaction ? "compacted" : "none",
  };
}

export class AcpSessionReadError extends Schema.TaggedError<AcpSessionReadError>()(
  "AcpSessionReadError",
  {
    stage: Schema.Literals(["spawn", "initialize", "load"]),
    /** What the agent itself answered, kept because its driver may know what it means. */
    agentRefusal: Schema.optional(
      Schema.Struct({ message: Schema.String, data: Schema.optional(Schema.Unknown) }),
    ),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read the ACP session at the ${this.stage} stage.`;
  }
}

export class AcpSessionLoadUnsupportedError extends Schema.TaggedError<AcpSessionLoadUnsupportedError>()(
  "AcpSessionLoadUnsupportedError",
  {},
) {
  override get message(): string {
    return "The ACP agent cannot load a session.";
  }
}

export class AcpSessionReadTimeoutError extends Schema.TaggedError<AcpSessionReadTimeoutError>()(
  "AcpSessionReadTimeoutError",
  { timeoutMs: Schema.Number },
) {
  override get message(): string {
    return `Reading the ACP session did not finish within ${this.timeoutMs} ms.`;
  }
}

export type AcpSessionHistoryError =
  | AcpSessionReadError
  | AcpSessionLoadUnsupportedError
  | AcpSessionReadTimeoutError;

const decodeInitializeResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    agentCapabilities: Schema.optional(
      Schema.Struct({ loadSession: Schema.optional(Schema.Boolean) }),
    ),
  }),
);

export interface ReadAcpSessionHistoryInput {
  readonly spawn: AcpSessionRuntime.AcpSpawnInput;
  readonly cwd: string;
  readonly sessionId: string;
  readonly platform: NodeJS.Platform;
  readonly loadMeta?: Readonly<Record<string, unknown>>;
  readonly timeout?: Duration.Duration;
}

/**
 * The client normalizer only knows ACP v2's upsert, so it hands a v1 `tool_call` over as unknown,
 * with the update intact.
 */
const acpV1Update = (update: EffectAcpSchema.SessionUpdate): EffectAcpSchema.SessionUpdate =>
  update.sessionUpdate === "_t3_unknown" && update.originalSessionUpdate === "tool_call"
    ? (update.raw as EffectAcpSchema.SessionUpdate)
    : update;

/**
 * Replays a session and ends the agent, without ever prompting it. Agent requests go unanswered by
 * any handler, so the client refuses them.
 *
 * This speaks ACP v1 through the raw requests on purpose, although `AcpClient` would negotiate v2.
 * `session/load` is v1's stable method, and the adapters' v2 surface is a draft: `claude-agent-acp`
 * 0.99.1 replays an edit with empty content there, and throws on any update it cannot translate
 * yet. `AcpSessionRuntime` is only the process owner here: its own session state stays unstarted,
 * which is why its replay quarantine does not apply to the handler below.
 */
export const readAcpSessionHistory = (
  input: ReadAcpSessionHistoryInput,
): Effect.Effect<
  AcpSessionHistory,
  AcpSessionHistoryError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> => {
  const timeout = input.timeout ?? DEFAULT_READ_TIMEOUT;
  return Effect.gen(function* () {
    const runtime = yield* AcpSessionRuntime.make({
      spawn: input.spawn,
      cwd: input.cwd,
      clientInfo: { name: "peer-session-reader", version: "1.0.0" },
      // `session/load` starts the real CLI under the adapter, so the adapter alone is not enough.
      ownDetachedProcessGroup: true,
      processGroupPlatform: input.platform,
      processGroupTerminationGrace: PROCESS_TERMINATION_GRACE,
    }).pipe(Effect.mapError((cause) => new AcpSessionReadError({ stage: "spawn", cause })));

    const updates: Array<EffectAcpSchema.SessionUpdate> = [];
    yield* runtime.handleSessionUpdate((notification) =>
      Effect.sync(() => {
        // Subagents replay on their own sessions, and those are not this thread's turns.
        if (notification.sessionId === input.sessionId) {
          updates.push(acpV1Update(notification.update));
        }
      }),
    );

    const initialized = yield* runtime
      .request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "peer-session-reader", version: "1.0.0" },
      })
      .pipe(
        Effect.flatMap(decodeInitializeResponse),
        Effect.mapError((cause) => new AcpSessionReadError({ stage: "initialize", cause })),
      );
    if (initialized.agentCapabilities?.loadSession !== true) {
      return yield* new AcpSessionLoadUnsupportedError();
    }

    yield* runtime
      .request("session/load", {
        sessionId: input.sessionId,
        cwd: input.cwd,
        mcpServers: [],
        ...(input.loadMeta === undefined ? {} : { _meta: input.loadMeta }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AcpSessionReadError({
              stage: "load",
              ...(cause._tag === "AcpRequestError"
                ? { agentRefusal: { message: cause.errorMessage, data: cause.data } }
                : {}),
              cause,
            }),
        ),
      );

    // Both adapters finish the replay before they answer, and the transport delivers one stdout
    // line at a time, so this is the whole history. What came later in real runs was never history:
    // commands, usage and Codex's model warning.
    const history = foldAcpSessionReplay(updates);

    // Not closing leaves the CLI to die mid-write. A slow close must not cost a finished read.
    yield* runtime
      .request("session/close", { sessionId: input.sessionId })
      .pipe(Effect.timeout(CLOSE_TIMEOUT), Effect.ignore);
    yield* (runtime.terminateProcessGroup ?? Effect.void).pipe(Effect.ignore);
    return history;
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(new AcpSessionReadTimeoutError({ timeoutMs: Duration.toMillis(timeout) })),
    }),
  );
};
