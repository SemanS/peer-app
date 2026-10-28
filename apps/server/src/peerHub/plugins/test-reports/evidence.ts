/**
 * "Seen run by Peer" (design D5): the session's last 200 shell commands, as its `postTool` hook saw
 * them end, with whether they failed and when. An item of a report whose text is one of them is
 * marked seen; Peer runs nothing to mark one, so the mark is only as good as the hook that saw it.
 *
 * @module peerHub/plugins/test-reports/evidence
 */
import type { PeerTestReportSeen } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** How many of a session's commands are kept. */
export const KEPT = 200;

export interface Ran {
  readonly command: string;
  readonly failed: boolean;
  readonly at: number;
}

/** A session's shell history, kept in its `local` state. */
export interface Shell {
  readonly ran: Array<Ran>;
}

export const emptyShell = (): Shell => ({ ran: [] });

/**
 * A command without the trim agents add to what it prints (`2>&1 | head -30`), so an item that names
 * the command reads as the command it ran. The rule of core's `withoutOutputTrim`, which core does
 * not export to plugins.
 */
export const commandOf = (command: string): string =>
  command.trim().replace(/\s*2>&1\s*(\|\s*(head|tail)(\s+-n)?\s+-?\d+)?$/, "");

/** Keeps a command the session ran, the oldest leaving once there are `KEPT`. */
export function remember(shell: Shell, command: string, failed: boolean, at: number): void {
  const text = commandOf(command);
  if (text === "") return;
  shell.ran.push({ command: text, failed, at });
  if (shell.ran.length > KEPT) shell.ran.splice(0, shell.ran.length - KEPT);
}

/** The latest run of exactly `text`, or undefined when Peer did not see the session run it. */
export function seen(shell: Shell, text: string): PeerTestReportSeen | undefined {
  const wanted = commandOf(text);
  for (let at = shell.ran.length - 1; at >= 0; at--) {
    const ran = shell.ran[at]!;
    if (ran.command === wanted)
      return { failed: ran.failed, at: DateTime.formatIso(DateTime.makeUnsafe(ran.at)) };
  }
  return undefined;
}
