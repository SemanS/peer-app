// @effect-diagnostics nodeBuiltinImport:off globalDate:off - each session's memory on disk, beside its working context.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * What each agent session was told, kept on disk beside its working context: what it heard of its
 * overlaps and which of them its people were shown (`SessionMemory`), the findings it heard, what
 * the index told it of each other work, the versions of the other works' contexts it read, the
 * version of its work's shared context it heard and whether it kept it, and what plugins told it. A
 * broker that starts again (Peer quit for an update, or ended without stopping) reads it back for
 * each session it meets again, so it tells none of them again what they heard, wakes none for it
 * and shows people no overlap twice, while what came meanwhile is not in it and is news.
 *
 * A session's file is written only while nothing it was told is on its way to it: a hook's answer
 * being prepared, what waits for its next step (`pending`), a wake Codex has not taken yet. A
 * restart drops those, so they must stay news for the next broker. Forgetting is written even then:
 * a conversation that starts again forgets what the index and plugins told it (`forgetTold`,
 * `forgetPluginTold`), and a file that still had it would keep the new conversation from hearing it.
 *
 * @module peerHub/core/broker/sessionMemory
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { scopeOf } from "../contexts/text.ts";
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

/** Of each list, the file keeps the newest this many: more than the 300 heard findings the Hub reads. */
const KEPT = 500;

/** All a session was told that a restart must not tell it again, as its file holds it. */
function inputManifest(broker: CoordinationBroker, session: LocalSession) {
  return {
    version: 1,
    environment: broker.host.environment,
    authority: broker.host.contextAuthority?.(session.workspace) ?? null,
    workspace: session.workspace,
    project: session.project,
    session: session.id,
    recovery: session.inputRecovery ?? "complete",
    imported: session.inputImports ?? [],
    lineage: session.inputLineage ?? [],
    reads: [...session.read].map(([scope, read]) => [
      scope,
      read.version,
      read.notifiedVersion,
      read.toldAt,
    ]),
    ...(session.task === undefined ? {} : { task: session.task }),
    ...(session.recoveryClosedAt === undefined ? {} : { closedAt: session.recoveryClosedAt }),
  };
}

function memoryText(broker: CoordinationBroker, session: LocalSession): string {
  return JSON.stringify({
    inputs: inputManifest(broker, session),
    ...Object.fromEntries(KINDS.map((kind) => [kind, [...session.memory[kind]].slice(-KEPT)])),
    heard: [...session.heard].slice(-KEPT),
    told: [...session.told],
    askedAt: session.askIndexAt,
    read: [...session.read].map(([scope, read]) => [
      scope,
      read.version,
      read.notifiedVersion,
      read.toldAt,
    ]),
    // The version it heard is of its work's context: a work it is put on later starts from none.
    ...(session.sharedHeard > 0 || session.keeps
      ? {
          shared: {
            scope: scopeOf(session.task),
            version: session.sharedHeard,
            toldAt: session.sharedToldAt,
            ...(session.keeps ? { keeps: true } : {}),
            ...(session.compactedAt > 0 ? { compactedAt: session.compactedAt } : {}),
          },
        }
      : {}),
    // A keeper of a closed task was asked, once, to mark what the project should keep.
    ...(session.toldClosed && session.task !== undefined ? { closed: session.task } : {}),
    plugins: Object.fromEntries(
      [...session.pluginTold].map(([plugin, told]) => [plugin, [...told].slice(-KEPT)]),
    ),
  });
}

/** Something it was told is on its way to it: in a hook's answer, its next step or Codex's queue. */
const onItsWay = (broker: CoordinationBroker, session: LocalSession) =>
  session.answering > 0 || session.pending.length > 0 || broker.queueing.has(session.id);

/**
 * What a session's file holds, less what the session forgot since it was written: what the index
 * told it, when its conversation starts again, and what a plugin told it, as the plugin drops it.
 */
function forgotten(broker: CoordinationBroker, session: LocalSession): string {
  const file =
    session.memoryFile === ""
      ? {}
      : (JSON.parse(session.memoryFile) as Readonly<Record<string, unknown>>);
  const plugins = file.plugins as Readonly<Record<string, unknown>> | undefined;
  return JSON.stringify({
    ...file,
    // Input receipts commit independently from delivery acknowledgments waiting for the agent.
    inputs: inputManifest(broker, session),
    ...(session.toldForgotten ? { told: [], askedAt: 0 } : {}),
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
  const text = onItsWay(broker, session) ? forgotten(broker, session) : memoryText(broker, session);
  return text === session.memoryFile ? null : text;
}

/**
 * A session's memory is kept beside its working context, `<session>.md`, in `<session>.memory.json`,
 * and retained with it while its work is open (`forgetOldContexts`).
 */
export const MEMORY_FILE = ".memory.json";

const memoryPath = (session: LocalSession) => session.ownContextPath.replace(/\.md$/, MEMORY_FILE);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** What a session Peer meets again was told before, read back; how many things it remembers. */
export async function restoreMemory(this: CoordinationBroker, session: LocalSession) {
  let text: string;
  let kept: unknown;
  try {
    text = await NodeFSP.readFile(memoryPath(session), "utf8");
    kept = JSON.parse(text);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    const existingNotes =
      missing &&
      (await NodeFSP.stat(session.ownContextPath).then(
        () => true,
        () => false,
      ));
    session.inputRecovery = missing
      ? existingNotes
        ? "revalidation-required"
        : "complete"
      : "unavailable";
    return 0;
  }
  if (typeof kept !== "object" || kept === null) {
    session.inputRecovery = "unavailable";
    return 0;
  }
  const file = kept as Readonly<Record<string, unknown>>;
  const inputs = file.inputs as Readonly<Record<string, unknown>> | undefined;
  const bound =
    inputs?.version === 1 &&
    inputs.environment === this.host.environment &&
    typeof inputs.authority === "string" &&
    inputs.authority === this.host.contextAuthority?.(session.workspace) &&
    inputs.workspace === session.workspace &&
    inputs.project === session.project &&
    inputs.session === session.id;
  if (inputs !== undefined && !bound) {
    session.inputRecovery = "unavailable";
    return 0;
  }
  session.inputRecovery =
    bound && inputs.recovery === "complete"
      ? "complete"
      : bound && inputs.recovery === "unavailable"
        ? "unavailable"
        : "revalidation-required";
  if (bound) {
    session.inputImports = strings(inputs.imported);
    session.inputLineage = strings(inputs.lineage);
  }
  if (bound && inputs.task === session.task && typeof inputs.closedAt === "string")
    session.recoveryClosedAt = inputs.closedAt;
  for (const kind of KINDS) for (const id of strings(file[kind])) session.memory[kind].add(id);
  for (const id of strings(file.heard)) session.heard.add(id);
  for (const pair of Array.isArray(file.told) ? file.told : []) {
    const [scope, key] = Array.isArray(pair) ? pair : [];
    if (typeof scope === "string" && typeof key === "string") session.told.set(scope, key);
  }
  if (typeof file.askedAt === "number") session.askIndexAt = file.askedAt;
  // The contexts it read, by version: Peer tells it when one changes, and does not tell it of
  // that work again in the index (`discoveryKey`).
  const reads = bound ? inputs.reads : file.read;
  if (bound && !Array.isArray(reads)) session.inputRecovery = "unavailable";
  for (const entry of Array.isArray(reads) ? reads : []) {
    const [scope, version, notifiedVersion, toldAt] = Array.isArray(entry) ? entry : [];
    if (
      typeof scope === "string" &&
      Number.isSafeInteger(version) &&
      typeof version === "number" &&
      version >= 0 &&
      typeof notifiedVersion === "number" &&
      Number.isSafeInteger(notifiedVersion) &&
      typeof toldAt === "number" &&
      Number.isFinite(toldAt)
    )
      session.read.set(scope, { version, text: undefined, notifiedVersion, toldAt });
    else session.inputRecovery = "unavailable";
  }
  const shared = file.shared as Readonly<Record<string, unknown>> | undefined;
  // What it heard of its work's shared context, while it is on that work still: Peer kept its
  // version, not its text.
  if (
    shared?.scope === scopeOf(session.task) &&
    typeof shared.version === "number" &&
    typeof shared.toldAt === "number"
  ) {
    session.sharedHeard = shared.version;
    session.sharedHeardText = undefined;
    session.sharedToldAt = shared.toldAt;
    // It takes back what it kept without being told so again (`followShared`).
    if (shared.keeps === true) session.keptBefore = shared.scope;
    if (typeof shared.compactedAt === "number") session.compactedAt = shared.compactedAt;
  }
  if (file.closed !== undefined && file.closed === session.task) session.toldClosed = true;
  const plugins = file.plugins as Readonly<Record<string, unknown>> | undefined;
  for (const [plugin, ids] of Object.entries(plugins ?? {})) {
    const told = new Set(strings(ids));
    if (told.size > 0) session.pluginTold.set(plugin, told);
  }
  session.memoryFile = text;
  return [...session.pluginTold.values()].reduce(
    (total, told) => total + told.size,
    KINDS.reduce(
      (total, kind) => total + session.memory[kind].size,
      session.heard.size + session.told.size + session.read.size,
    ),
  );
}

/**
 * A conversation that starts again, or was compacted, knows nothing the index told it: the session
 * forgets that, and its file does at the next round, whatever is on its way to it.
 */
export function forgetTold(session: LocalSession) {
  session.told.clear();
  session.askIndexAt = 0;
  session.toldForgotten = true;
}

/** A new runtime generation (a conversation that starts again) forgets what plugins told it too. */
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
  ].filter((session) => {
    const closed =
      session.task !== undefined &&
      this.host.taskDone(session.workspace, session.project, session.task);
    if (closed) session.recoveryClosedAt ??= new Date().toISOString();
    else session.recoveryClosedAt = undefined;
    return fileText(this, session) !== null;
  });
  if (due.length === 0) return Promise.resolve();
  const run = (async () => {
    for (const session of due) {
      // The writes before it took a while: something it was told may be on its way to it by now.
      const text = fileText(this, session);
      if (text === null) continue;
      // A file that could not be written is written again once the session's memory changes;
      // until then a restart repeats some of what it heard.
      const path = memoryPath(session);
      const temporary = `${path}.${process.pid}.tmp`;
      try {
        await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
        await NodeFSP.writeFile(temporary, text);
        await NodeFSP.rename(temporary, path);
        session.memoryFile = text;
        session.toldForgotten = false;
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
