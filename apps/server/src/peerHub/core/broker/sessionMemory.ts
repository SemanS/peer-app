// @effect-diagnostics nodeBuiltinImport:off globalDate:off - each session's memory on disk.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * What each agent session was told, kept on disk: what it heard of its overlaps and which of them
 * its people were shown (`SessionMemory`), and what plugins told it. A broker that starts again
 * (Peer quit for an update, or ended without stopping) reads it back for each session it meets
 * again, so it tells none of them again what they heard, wakes none for it and shows people no
 * overlap twice, while what came meanwhile is not in it and is news.
 *
 * A session's file is written only while nothing it was told is on its way to it: a hook's answer
 * being prepared, what waits for its next step (`pending`), a wake Codex has not taken yet. A
 * restart drops those, so they must stay news for the next broker. Forgetting is written even then:
 * a conversation that starts again forgets what plugins told it (`forgetPluginTold`), and a file
 * that still had it would keep the new conversation from hearing it.
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
  "notified",
] as const satisfies ReadonlyArray<keyof SessionMemory>;

/** Of each list, the file keeps the newest this many. */
const KEPT = 500;

/** A file nobody wrote for this long belongs to work long gone. */
const FORGOTTEN_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/** All a session was told that a restart must not tell it again, as its file holds it. */
function memoryText(session: LocalSession): string {
  return JSON.stringify({
    ...Object.fromEntries(KINDS.map((kind) => [kind, [...session.memory[kind]].slice(-KEPT)])),
    plugins: Object.fromEntries(
      [...session.pluginTold].map(([plugin, told]) => [plugin, [...told].slice(-KEPT)]),
    ),
  });
}

/** Something it was told is on its way to it: in a hook's answer, its next step or Codex's queue. */
const onItsWay = (broker: CoordinationBroker, session: LocalSession) =>
  session.answering > 0 || session.pending.length > 0 || broker.queueing.has(session.id);

/** What a session's file holds, less what a plugin told it and the plugin dropped since. */
function forgotten(session: LocalSession): string {
  const file =
    session.memoryFile === ""
      ? {}
      : (JSON.parse(session.memoryFile) as Readonly<Record<string, unknown>>);
  const plugins = file.plugins as Readonly<Record<string, unknown>> | undefined;
  return JSON.stringify({
    ...file,
    plugins: session.pluginsForgotten
      ? {}
      : Object.fromEntries(
          Object.entries(plugins ?? {}).map(([plugin, ids]) => [
            plugin,
            strings(ids).filter((id) => session.pluginTold.get(plugin)?.has(id) === true),
          ]),
        ),
  });
}

/**
 * What a session's file is to hold now, when that is not what it holds: all it was told, once
 * nothing is on its way to it; until then what it held, less what the session forgot.
 */
function fileText(broker: CoordinationBroker, session: LocalSession): string | null {
  const text = onItsWay(broker, session) ? forgotten(session) : memoryText(session);
  return text === session.memoryFile ? null : text;
}

/** A session's memory file: `<run or session id>.memory.json`. */
export const MEMORY_FILE = ".memory.json";

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** What a session Peer meets again was told before, read back; how many things it remembers. */
export async function restoreMemory(this: CoordinationBroker, session: LocalSession) {
  let text: string;
  let kept: unknown;
  try {
    // A Peer from before kept these files with the agents' working contexts.
    text = await NodeFSP.readFile(session.memoryPath, "utf8").catch(() =>
      NodeFSP.readFile(this.host.formerMemoryPath(session.memoryPath), "utf8"),
    );
    kept = JSON.parse(text);
  } catch {
    return 0;
  }
  if (typeof kept !== "object" || kept === null) return 0;
  const file = kept as Readonly<Record<string, unknown>>;
  for (const kind of KINDS) for (const id of strings(file[kind])) session.memory[kind].add(id);
  const plugins = file.plugins as Readonly<Record<string, unknown>> | undefined;
  for (const [plugin, ids] of Object.entries(plugins ?? {})) {
    const told = new Set(strings(ids));
    if (told.size > 0) session.pluginTold.set(plugin, told);
  }
  session.memoryFile = text;
  return [...session.pluginTold.values()].reduce(
    (total, told) => total + told.size,
    KINDS.reduce((total, kind) => total + session.memory[kind].size, 0),
  );
}

/** A new runtime generation (a conversation that starts again) forgets what plugins told it. */
export function forgetPluginTold(session: LocalSession) {
  session.pluginTold.clear();
  session.pluginsForgotten = true;
}

/**
 * Writes the file of each session whose file is to change (`fileText`). One round at a time: asked
 * for during one, another follows it.
 */
export function saveMemories(this: CoordinationBroker): Promise<void> {
  if (this.savingMemories !== null) return this.savingMemories.then(() => this.saveMemories());
  const due = [
    ...this.sessions.values(),
    ...[...this.dormantSessions.values()].filter((session) => !this.sessions.has(session.id)),
  ].filter((session) => fileText(this, session) !== null);
  if (due.length === 0) return Promise.resolve();
  const run = (async () => {
    for (const session of due) {
      // The writes before it took a while: something it was told may be on its way to it by now.
      const text = fileText(this, session);
      if (text === null) continue;
      // A file that could not be written is written again once the session's memory changes;
      // until then a restart repeats some of what it heard.
      const path = session.memoryPath;
      const temporary = `${path}.${process.pid}.tmp`;
      try {
        await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
        await NodeFSP.writeFile(temporary, text);
        await NodeFSP.rename(temporary, path);
        session.memoryFile = text;
        session.pluginsForgotten = false;
      } catch (error) {
        this.record("session.memory.failed", { session: session.id, reason: messageOf(error) });
      } finally {
        await NodeFSP.rm(temporary, { force: true }).catch(() => undefined);
      }
    }
  })();
  this.savingMemories = run.finally(() => {
    this.savingMemories = null;
  });
  return this.savingMemories;
}

/** Removes the memory files nobody wrote for months, those of sessions Peer holds aside. */
export async function forgetOldMemories(this: CoordinationBroker) {
  const held = new Set(
    [...this.sessions.values(), ...this.dormantSessions.values()].map((s) => s.memoryPath),
  );
  const cutoff = Date.now() - FORGOTTEN_AFTER_MS;
  const walk = async (dir: string): Promise<void> => {
    const entries = await NodeFSP.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(MEMORY_FILE) && !held.has(path)) {
        const written = await NodeFSP.stat(path).then(
          (stat) => stat.mtimeMs,
          () => Date.now(),
        );
        if (written < cutoff) await NodeFSP.rm(path, { force: true }).catch(() => undefined);
      }
    }
  };
  await walk(this.host.memoryDir);
}
