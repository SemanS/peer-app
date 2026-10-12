// @effect-diagnostics nodeBuiltinImport:off - each session's memory on disk, beside its working context.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * What each agent session was told of its overlaps (`SessionMemory`), kept on disk beside its
 * working context. A broker that starts again (Peer quit for an update, or ended without stopping)
 * reads it back for each session it meets again, so it tells none of them again what they heard and
 * wakes none for it, while a note or an overlap that came meanwhile is not in it and is news.
 *
 * A session's memory is written only while nothing waits for its next step: what does (`pending`)
 * has not reached the agent, and a restart drops it, so it must stay news for the next broker.
 *
 * @module peerHub/core/broker/sessionMemory
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { SessionMemory } from "../coordination/edits.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { messageOf } from "./log.ts";
import type { LocalSession } from "./sessions.ts";

const KINDS = [
  "announced",
  "seenNotes",
  "acknowledged",
  "settled",
] as const satisfies ReadonlyArray<keyof SessionMemory>;

/** Of each kind, the file keeps the newest this many. */
const KEPT = 500;

/** How much a memory holds. Its sets only grow, so any change shows here. */
const sizeOf = (memory: SessionMemory) =>
  KINDS.reduce((total, kind) => total + memory[kind].size, 0);

/** A session told something its file lacks, with nothing waiting for its next step. */
const unsaved = (session: LocalSession) =>
  session.pending.length === 0 && sizeOf(session.memory) !== session.memorySaved;

/**
 * A session's memory is kept beside its working context, `<session>.md`, in `<session>.memory.json`,
 * and forgotten with it (`forgetOldContexts`).
 */
export const MEMORY_FILE = ".memory.json";

const memoryPath = (session: LocalSession) => session.ownContextPath.replace(/\.md$/, MEMORY_FILE);

/** What a session Peer meets again was told before, read back into its memory. */
export async function restoreMemory(this: CoordinationBroker, session: LocalSession) {
  let kept: unknown;
  try {
    kept = JSON.parse(await NodeFSP.readFile(memoryPath(session), "utf8"));
  } catch {
    // Told nothing yet, or the file is unreadable: it hears what there is.
    return;
  }
  if (typeof kept !== "object" || kept === null) return;
  for (const kind of KINDS) {
    const ids = (kept as Readonly<Record<string, unknown>>)[kind];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) if (typeof id === "string") session.memory[kind].add(id);
  }
  session.memorySaved = sizeOf(session.memory);
}

/**
 * Writes the memory of each session that was told something since its file was written and has
 * nothing waiting for its next step. One round at a time: asked for during one, another follows it.
 */
export function saveMemories(this: CoordinationBroker): Promise<void> {
  if (this.savingMemories !== null) return this.savingMemories.then(() => this.saveMemories());
  const due = [...this.sessions.values()].filter(unsaved);
  if (due.length === 0) return Promise.resolve();
  const run = (async () => {
    for (const session of due) {
      // The writes before it took a while: news may wait for its next step by now.
      if (!unsaved(session)) continue;
      const size = sizeOf(session.memory);
      const kept = Object.fromEntries(
        KINDS.map((kind) => [kind, [...session.memory[kind]].slice(-KEPT)]),
      );
      // A file that could not be written is tried again once the session is told more; until
      // then a restart repeats some of what it heard, and loses none of it.
      session.memorySaved = size;
      const path = memoryPath(session);
      const temporary = `${path}.${process.pid}.tmp`;
      try {
        await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
        await NodeFSP.writeFile(temporary, JSON.stringify(kept));
        await NodeFSP.rename(temporary, path);
      } catch (error) {
        this.record("session.memory.failed", { session: session.id, reason: messageOf(error) });
      }
    }
  })();
  this.savingMemories = run.finally(() => {
    this.savingMemories = null;
  });
  return this.savingMemories;
}
