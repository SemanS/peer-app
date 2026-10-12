/**
 * What a computer's coordination log says Peer told an agent, shared by the lab steps that count
 * it: a line of the debug log (`coordination.debug.jsonl`), what a hook printed for Claude Code,
 * and the texts Peer put into a session's context, whichever hook or command carried them.
 */

/** A line of a computer's debug log. */
export interface LabEvent {
  readonly event: string;
  readonly t?: string;
  readonly session?: unknown;
  readonly [field: string]: unknown;
}

/** What a hook printed for Claude Code. */
export type HookOut = {
  readonly hookSpecificOutput?: {
    readonly additionalContext?: string;
    readonly permissionDecision?: string;
    readonly permissionDecisionReason?: string;
  };
} | null;

/**
 * The texts Peer's hooks put into the context of the sessions `events` belong to, in order: what a
 * `hook` event answered with, as context or as the reason a tool call was stopped.
 */
export function toldTexts(events: ReadonlyArray<LabEvent>): ReadonlyArray<string> {
  return events.flatMap((entry) => {
    if (entry.event !== "hook" || typeof entry.answer !== "object" || entry.answer === null)
      return [];
    const output = (entry.answer as NonNullable<HookOut>).hookSpecificOutput;
    return [output?.additionalContext, output?.permissionDecisionReason].filter(
      (text): text is string => typeof text === "string",
    );
  });
}

/** The plain id of a session: its hooks log `claude:<id>`, its commands `<id>`. */
export const plainSession = (session: unknown) => String(session).replace(/^(claude|codex):/, "");

/**
 * What Peer added to an agent's context, in characters: what its hooks answered with, and what its
 * `peer` commands printed (the agent asked for those, and read them). A token is about four
 * characters. `session` is a plain id; without one, every session of the log counts.
 */
export function peerAdded(events: ReadonlyArray<LabEvent>, session?: string) {
  const mine = (entry: LabEvent) =>
    session === undefined || plainSession(entry.session) === session;
  let hooks = 0;
  let commands = 0;
  for (const entry of events) {
    if (!mine(entry)) continue;
    if (entry.event === "hook" && typeof entry.chars === "number") hooks += entry.chars;
    else if (entry.event === "cli" && typeof entry.out === "string") commands += entry.out.length;
    else if (entry.event === "cli" && typeof entry.reason === "string")
      commands += entry.reason.length;
  }
  return { hooks, commands, chars: hooks + commands };
}
