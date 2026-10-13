/**
 * The team index blocks Peer's hooks gave an agent, read from its computer's coordination log: the
 * other work a start names, the block with an ask or a step (the first, or what changed since), and
 * the line that points back after a pause. Wakes never carry them, so hook answers are all there is.
 */
export type IndexBlockKind = "start" | "first" | "changed" | "reminder";

/** How each block's first line begins (`core/index/text.ts`; its test holds the two together). */
const HEADS: ReadonlyArray<readonly [IndexBlockKind, string]> = [
  ["start", "Other work on this project now"],
  ["first", "Peer · what the project's other agents build"],
  ["changed", "Peer · new or changed in the others' work"],
  ["reminder", "Peer · the others' work is named above"],
];

export function indexBlocks(
  events: ReadonlyArray<{
    event: string;
    session?: unknown;
    hookEvent?: unknown;
    answer?: unknown;
    [field: string]: unknown;
  }>,
) {
  const blocks: Array<{
    session: string;
    hookEvent: string;
    kind: IndexBlockKind;
    line: string;
  }> = [];
  for (const entry of events) {
    if (entry.event !== "hook" || typeof entry.answer !== "object" || entry.answer === null)
      continue;
    const output = (entry.answer as { hookSpecificOutput?: Record<string, unknown> })
      .hookSpecificOutput;
    for (const field of ["additionalContext", "permissionDecisionReason"]) {
      const text = output?.[field];
      if (typeof text !== "string") continue;
      for (const line of text.split("\n")) {
        const kind = HEADS.find(([, head]) => line.startsWith(head))?.[0];
        if (kind !== undefined)
          blocks.push({
            session: String(entry.session),
            hookEvent: String(entry.hookEvent),
            kind,
            line,
          });
      }
    }
  }
  // Which hooks carried which, for the lab's report: "SessionStart start, PostToolUse changed ×3".
  const counted = new Map<string, number>();
  for (const block of blocks) {
    const what = `${block.hookEvent} ${block.kind}`;
    counted.set(what, (counted.get(what) ?? 0) + 1);
  }
  const summary = [...counted].map(([what, n]) => (n === 1 ? what : `${what} ×${n}`)).join(", ");
  return { blocks, summary };
}
