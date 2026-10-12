// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off globalDate:off - agents' working contexts and shared-context copies on disk, kept in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Working and shared contexts, as the broker keeps them. Each agent keeps its own working
 * context in a file. Work on a task, or on a project outside tasks, has one shared context, kept
 * by one agent session at a time and copied into a file the agents here read: taking it up,
 * writing it, handing it over and following it as the Hub's view changes.
 *
 * @module peerHub/core/contexts/contexts
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { clip, neutral } from "../../peerText.ts";
import type { CoordinationBroker } from "../broker/Broker.ts";
import { messageOf } from "../broker/log.ts";
import { MEMORY_FILE } from "../broker/sessionMemory.ts";
import { type LocalSession, safePart } from "../broker/sessions.ts";
import { newOp } from "../broker/sync.ts";
import type { ContextRefusal, HubContextKeeper, HubContextText } from "../hub/coordApi.ts";
import {
  compactionNudge,
  contextWritten,
  findingsForKeeper,
  findingsOnWork,
  projectLines,
  scopeOf,
  type SharedContext,
  sharedTemplate,
  teamLines,
  type WorkAgent,
} from "./text.ts";

/** A shared context as this computer has it: in memory, and in a file its agents read. */
export interface SharedMirror {
  readonly workspace: string;
  readonly project: string;
  readonly scope: string;
  readonly path: string;
  version: number;
  epoch?: number | undefined;
  text: string;
  keeper: HubContextKeeper | undefined;
  updatedAt: string;
  updatedBy: string | undefined;
  /** The agent session that wrote it; none when a person brought an older version back. */
  updatedSession: string | undefined;
  restoredFrom: number | undefined;
  /** Its keeper here changed it and the hub has not taken the change yet. */
  unsent: boolean;
  /** The write to the hub in flight: the next waits for it, so none is mistaken for another's. */
  pushing: Promise<void> | undefined;
}

/** An agent whose working context has not changed for this long, while it works, is reminded once. */
const NUDGE_MS = 20 * 60 * 1000;

/** A shared context nobody keeps is asked for at most this often per work. */
const CLAIM_GAP_MS = 20_000;

/** What the hub keeps of a shared context. */
export const SHARED_MAX_BYTES = 32 * 1024;

/** About 6K tokens: past this a keeper is told to compact, again for every 4 KiB more. */
const SHARED_COMPACT_BYTES = 24 * 1024;
const SHARED_COMPACT_STEP = 4 * 1024;

/**
 * A keeper idle this long, while an agent here works on its work, gives way (the
 * hub decides): ten minutes, or `PEER_KEEPER_IDLE_MS` (the coordination lab shortens it).
 */
const KEEPER_IDLE_MS = Number(process.env.PEER_KEEPER_IDLE_MS) || 10 * 60 * 1000;

/** What an existing working context already says, read when Peer meets its session. */
export async function restoreContext(this: CoordinationBroker, session: LocalSession) {
  try {
    const [text, stat] = await Promise.all([
      NodeFSP.readFile(session.ownContextPath, "utf8"),
      NodeFSP.stat(session.ownContextPath),
    ]);
    session.team = teamLines(text);
    session.contextAt = stat.mtimeMs;
    session.contextKept = contextWritten(text);
  } catch {
    // No working context yet: SessionStart makes one.
  }
}

/** Working contexts of sessions nobody has touched for a month go, and so do their memories. */
export async function forgetOldContexts(this: CoordinationBroker) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const walk = async (dir: string): Promise<void> => {
    const entries = await NodeFSP.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".md") || entry.name.includes(MEMORY_FILE)) {
        const stat = await NodeFSP.stat(path).catch(() => null);
        if (stat !== null && stat.mtimeMs < cutoff) await NodeFSP.rm(path, { force: true });
      }
    }
  };
  await walk(this.host.contextsDir);
}

/** The agent changed its own working context: what it shares with the team may have changed. */
export async function readTeamLines(this: CoordinationBroker, session: LocalSession) {
  let text: string;
  try {
    text = await NodeFSP.readFile(session.ownContextPath, "utf8");
  } catch {
    return;
  }
  if (!session.keeps) {
    session.contextAt = Date.now();
    session.contextKept = true;
  }
  const team = teamLines(text);
  const changed = team.join("\n") !== session.team.join("\n");
  session.team = team;
  this.record("context.updated", { session: session.id, bytes: text.length, team, changed });
  if (changed) this.markDirty();
}

/**
 * A reminder in a line: at an agent's first change while its working context
 * is still empty, and when it has gone stale while the agent works.
 */
export function nudge(
  this: CoordinationBroker,
  session: LocalSession,
  changed: string | null,
): string | null {
  const now = Date.now();
  // A keeper is reminded of the shared context it keeps, not of its private notes.
  const path = session.keeps
    ? (this.mirrorOf(session)?.path ?? session.contextPath)
    : session.contextPath;
  if (changed !== null && !session.contextKept && !session.remindedAtStart) {
    session.remindedAtStart = true;
    this.record("context.nudged", { session: session.id, why: "first change", file: changed });
    return session.keeps
      ? `Peer: you changed ${changed} and the shared context you keep (${path}) is still empty. Note there where the work stands and what you found; your teammates' agents read it.`
      : `Peer: you changed ${changed} and your working context (${path}) is still empty. Note there what you are doing and what you found; put what your teammates' agents should know under "## For the team".`;
  }
  if (
    now - session.startedAt < NUDGE_MS ||
    now - session.contextAt < NUDGE_MS ||
    now - session.nudgedAt < NUDGE_MS
  ) {
    return null;
  }
  session.nudgedAt = now;
  const minutes = Math.round((now - session.contextAt) / 60_000);
  this.record("context.nudged", { session: session.id, why: "stale", minutes });
  return `Peer: ${session.keeps ? "the shared context you keep" : "your working context"} (${path}) has not changed for ${minutes} minutes. Update it if ${session.keeps ? "where the work stands, its findings or the plan" : "your goal, findings or plan"} moved.`;
}

export async function checkpointPrivate(this: CoordinationBroker, session: LocalSession) {
  try {
    const stat = await NodeFSP.lstat(session.ownContextPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const text = await NodeFSP.readFile(session.ownContextPath, "utf8");
    const temporary = `${session.ownContextPath}.checkpoint.${NodeCrypto.randomUUID()}`;
    await NodeFSP.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await NodeFSP.rename(temporary, `${session.ownContextPath}.checkpoint.md`);
    this.record("context.checkpoint", {
      session: session.id,
      path: `${session.ownContextPath}.checkpoint.md`,
    });
  } catch (error) {
    this.record("context.checkpoint.failed", { session: session.id, reason: messageOf(error) });
  }
}

/** The agent's own working context, or the shared context it keeps. */
export function keptBy(this: CoordinationBroker, session: LocalSession, path: string): boolean {
  return (
    this.samePath(path, session.ownContextPath) ||
    (session.keeps && this.samePath(path, this.mirrorOf(session)?.path ?? session.contextPath))
  );
}

export function sharedKey(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  scope: string,
) {
  return `${workspace}\u0000${project}\u0000${scope}`;
}

export function mirrorOf(
  this: CoordinationBroker,
  session: LocalSession,
): SharedMirror | undefined {
  return this.shared.get(this.sharedKey(session.workspace, session.project, scopeOf(session.task)));
}

export function sharedOf(this: CoordinationBroker, mirror: SharedMirror): SharedContext {
  return {
    subject: this.subjectOf(mirror.workspace, mirror.project, mirror.scope),
    path: mirror.path,
    text: mirror.text,
    version: mirror.version,
    keeper:
      mirror.keeper === undefined
        ? undefined
        : this.host.nameOf(mirror.workspace, mirror.keeper.email),
  };
}

/** Who keeps the shared context of a session's work, when it is another session still at work. */
export function keeperOf(
  this: CoordinationBroker,
  session: LocalSession,
): HubContextKeeper | undefined {
  const keeper = this.mirrorOf(session)?.keeper;
  if (keeper === undefined || keeper.session === session.id) return undefined;
  const atWork = this.merged(session.workspace, this.views.get(session.workspace)).sessions;
  return atWork.some((s) => s.id === keeper.session) ? keeper : undefined;
}

/** The other agents at work on the same work, as people name them. */
export function agentsOn(this: CoordinationBroker, session: LocalSession): WorkAgent[] {
  return this.merged(session.workspace, this.views.get(session.workspace))
    .sessions.filter(
      (s) =>
        s.id !== session.id &&
        s.project === session.project &&
        scopeOf(s.task) === scopeOf(session.task),
    )
    .map((s) => ({
      id: s.id,
      name: `${this.host.nameOf(session.workspace, s.email)}'s agent ("${s.label}")`,
    }));
}

/**
 * Takes in a shared context as the hub has it, in memory and in the file the
 * agents here read: when it is newer than what is here, or with `force`.
 */
export async function mirror(
  this: CoordinationBroker,
  workspace: string,
  context: HubContextText,
  force = false,
): Promise<SharedMirror> {
  const key = this.sharedKey(workspace, context.project, context.scope);
  const known = this.shared.get(key);
  const mirror: SharedMirror = known ?? {
    workspace,
    project: context.project,
    scope: context.scope,
    path: NodePath.join(
      this.host.contextsDir,
      safePart(workspace),
      safePart(context.project),
      "shared",
      `${safePart(context.scope)}.md`,
    ),
    version: -1,
    text: "",
    keeper: undefined,
    updatedAt: context.updatedAt,
    updatedBy: undefined,
    updatedSession: undefined,
    restoredFrom: undefined,
    unsent: false,
    pushing: undefined,
  };
  this.shared.set(key, mirror);
  mirror.keeper = context.keeper;
  mirror.epoch = context.epoch ?? context.keeper?.epoch;
  if (!force && context.version <= mirror.version) return mirror;
  // Nobody wrote it yet: its keeper starts from a template, which is not news to anyone.
  const file =
    context.text.trim() === ""
      ? sharedTemplate(this.subjectOf(workspace, context.project, context.scope))
      : context.text;
  mirror.version = context.version;
  mirror.text = file;
  mirror.updatedAt = context.updatedAt;
  mirror.updatedBy = context.updatedBy;
  mirror.updatedSession = context.updatedSession;
  mirror.restoredFrom = context.restoredFrom;
  mirror.unsent = false;
  try {
    await NodeFSP.mkdir(NodePath.dirname(mirror.path), { recursive: true });
    await this.writeMirror(mirror.path, file, known === undefined ? context.updatedAt : undefined);
  } catch (error) {
    this.record("shared.mirror.failed", { path: mirror.path, error: messageOf(error) });
  }
  return mirror;
}

/**
 * Writes a shared context's copy in one step, never through a link, so an agent reading it
 * never sees half of it. A copy this process has not met, changed here after the hub's version
 * was written, is edits its keeper had not shared (the hub could not be reached, say): they are
 * kept beside it, not overwritten.
 */
export async function writeMirror(
  this: CoordinationBroker,
  path: string,
  text: string,
  hubWrittenAt: string | undefined,
) {
  const stat = await NodeFSP.lstat(path).catch(() => null);
  if (stat?.isSymbolicLink() === true) await NodeFSP.rm(path, { force: true });
  else if (
    stat?.isFile() === true &&
    hubWrittenAt !== undefined &&
    stat.mtimeMs > Date.parse(hubWrittenAt)
  ) {
    const there = await NodeFSP.readFile(path, "utf8").catch(() => null);
    if (there !== null && there !== text && contextWritten(there)) {
      await NodeFSP.writeFile(`${path}.unsent`, there);
      this.record("shared.stashed", { path });
    }
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, text);
  await NodeFSP.rename(temporary, path);
}

/** Keeps what a keeper wrote that the hub refused beside its file, before the file takes the hub's text. */
export async function stash(this: CoordinationBroker, mirror: SharedMirror): Promise<boolean> {
  try {
    await NodeFSP.writeFile(`${mirror.path}.unsent`, mirror.text);
    this.record("shared.stashed", { path: mirror.path, bytes: mirror.text.length });
    return true;
  } catch {
    return false;
  }
}

/** Asks the hub for the session to keep its work's shared context; otherwise reads it. */
export async function takeUp(this: CoordinationBroker, session: LocalSession): Promise<void> {
  const scope = scopeOf(session.task);
  let answer: HubContextText | ContextRefusal;
  try {
    answer = await this.host.keepContext(
      session.workspace,
      session.project,
      scope,
      session.id,
      false,
    );
  } catch (error) {
    this.record("shared.failed", { session: session.id, scope, error: messageOf(error) });
    return;
  }
  if ("refused" in answer) {
    const current =
      answer.refused === "stale"
        ? answer.current
        : await this.host.readContext(session.workspace, session.project, scope).catch(() => null);
    if (current !== null) await this.mirror(session.workspace, current);
    if (session.keeps) await this.read(session);
    this.record("shared.read", {
      session: session.id,
      scope,
      keeper: answer.refused === "kept" ? answer.keeper?.session : undefined,
      version: current?.version,
    });
    return;
  }
  this.keep(session, await this.mirror(session.workspace, answer));
  this.record("shared.kept", { session: session.id, scope, version: answer.version });
}

export function keep(this: CoordinationBroker, session: LocalSession, mirror: SharedMirror) {
  session.keeps = true;
  session.contextPath = session.ownContextPath;
  session.sharedHeard = mirror.version;
  session.sharedHeardText = mirror.text;
  session.remindedAtStart = false;
  // What it keeps now is what its reminders are about: written already, it is not "still empty".
  session.contextKept = contextWritten(mirror.text);
  session.contextAt = Date.now();
  mirror.keeper = {
    session: session.id,
    email: this.host.email() ?? "",
    environment: this.host.environment,
    since: new Date().toISOString(),
    ...(mirror.epoch === undefined ? {} : { epoch: mirror.epoch }),
  };
}

/** The session no longer keeps the shared context: its own working context is its own again. */
export async function read(this: CoordinationBroker, session: LocalSession) {
  session.keeps = false;
  session.contextPath = session.ownContextPath;
  session.contextKept = false;
  await this.restoreContext(session);
}

/** Gives up the shared context a session keeps, so the next agent on the work keeps it at once. */
export async function release(this: CoordinationBroker, session: LocalSession): Promise<void> {
  if (!session.keeps) return;
  session.keeps = false;
  session.contextPath = session.ownContextPath;
  const scope = scopeOf(session.task);
  this.record("shared.released", { session: session.id, scope });
  await this.host
    .keepContext(
      session.workspace,
      session.project,
      scope,
      session.id,
      true,
      this.mirrorOf(session)?.epoch,
      newOp(),
    )
    .catch((error: unknown) =>
      this.record("shared.release.failed", { session: session.id, scope, error: messageOf(error) }),
    );
}

/** When the keeper changed the shared context, the hub gets the new version. */
export async function saveShared(this: CoordinationBroker, session: LocalSession) {
  const mirror = this.mirrorOf(session);
  if (mirror === undefined) return;
  // A link where the file should be would share whatever it points to.
  const linked = await NodeFSP.lstat(mirror.path).then(
    (stat) => stat.isSymbolicLink(),
    () => false,
  );
  if (linked) {
    this.record("shared.linked", { path: mirror.path });
    return;
  }
  const text = await NodeFSP.readFile(mirror.path, "utf8").catch(() => null);
  if (text === null || text === mirror.text) return;
  session.contextAt = Date.now();
  session.contextKept = contextWritten(text);
  const before = new Set(projectLines(mirror.text));
  const after = projectLines(text);
  for (const line of after) if (!before.has(line)) session.marked.add(line);
  for (const line of before) if (!after.includes(line)) session.marked.delete(line);
  mirror.text = text;
  if (Buffer.byteLength(text) > SHARED_MAX_BYTES) {
    // The hub would refuse it: the team keeps the last version until the keeper shortens it.
    session.pending.push(
      `Peer: the shared context you keep (${mirror.path}) is over 32 KiB, so your teammates' agents still read version ${mirror.version}. Shorten it to what the work needs; Peer shares it again then.`,
    );
    this.record("shared.too_large", {
      session: session.id,
      scope: mirror.scope,
      bytes: Buffer.byteLength(text),
    });
    return;
  }
  mirror.unsent = true;
  await this.pushShared(session, mirror);
}

/**
 * Sends the keeper's change to the hub, one write at a time per context: a hook's write and a
 * sync's, both on the version before, would make the second see the first as another's change.
 */
export function pushShared(
  this: CoordinationBroker,
  session: LocalSession,
  mirror: SharedMirror,
): Promise<void> {
  const run = (mirror.pushing ?? Promise.resolve()).then(() => this.pushNow(session, mirror));
  const tracked = run.finally(() => {
    if (mirror.pushing === tracked) mirror.pushing = undefined;
  });
  mirror.pushing = tracked;
  return tracked;
}

export async function pushNow(
  this: CoordinationBroker,
  session: LocalSession,
  mirror: SharedMirror,
) {
  // An earlier write took what there was to send.
  if (!mirror.unsent) return;
  // The text this write carries: the keeper may change the file again while it is on its way.
  const sent = mirror.text;
  let answer: HubContextText | ContextRefusal;
  try {
    answer = await this.host.writeContext(
      mirror.workspace,
      mirror.project,
      mirror.scope,
      session.id,
      mirror.version,
      sent,
      mirror.epoch,
      newOp(),
    );
  } catch (error) {
    // It goes again at the next sync.
    this.record("shared.unsent", {
      session: session.id,
      scope: mirror.scope,
      error: messageOf(error),
    });
    return;
  }
  const subject = this.subjectOf(mirror.workspace, mirror.project, mirror.scope);
  if (!("refused" in answer)) {
    mirror.version = answer.version;
    mirror.epoch = answer.epoch ?? answer.keeper?.epoch;
    mirror.updatedAt = answer.updatedAt;
    mirror.updatedBy = answer.updatedBy;
    mirror.updatedSession = answer.updatedSession;
    mirror.restoredFrom = undefined;
    // A change made while this write was on its way is still to be sent: the next write does.
    mirror.unsent = mirror.text !== sent;
    session.sharedHeard = answer.version;
    session.sharedHeardText = sent;
    const bytes = Buffer.byteLength(sent);
    if (bytes < SHARED_COMPACT_BYTES) session.compactedAt = 0;
    else if (bytes >= session.compactedAt + SHARED_COMPACT_STEP) {
      session.compactedAt = bytes;
      session.pending.push(compactionNudge(mirror.path, bytes));
      this.record("shared.compact", { session: session.id, scope: mirror.scope, bytes });
    }
    this.markDirty();
    this.record("shared.written", {
      session: session.id,
      scope: mirror.scope,
      version: answer.version,
      bytes: sent.length,
    });
    this.host.changed();
    return;
  }
  if (answer.refused === "stale" && answer.current.text === sent) {
    // Its own change, which the hub took already (a write that timed out): nothing was lost.
    mirror.version = answer.current.version;
    mirror.updatedAt = answer.current.updatedAt;
    mirror.updatedBy = answer.current.updatedBy;
    mirror.updatedSession = answer.current.updatedSession;
    mirror.unsent = mirror.text !== sent;
    session.sharedHeard = answer.current.version;
    session.sharedHeardText = sent;
    this.markDirty();
    this.record("shared.written", {
      session: session.id,
      scope: mirror.scope,
      version: answer.current.version,
      bytes: sent.length,
      already: true,
    });
    return;
  }
  if (answer.refused === "stale") {
    // What the keeper wrote is kept beside the file, which now takes the hub's version.
    const kept = await this.stash(mirror);
    await this.mirror(mirror.workspace, answer.current, true);
    const by = answer.current.updatedBy;
    session.pending.push(
      `Peer: the shared context of ${subject} changed meanwhile (version ${answer.current.version}${by === undefined ? "" : `, by ${this.host.nameOf(mirror.workspace, by)}'s agent`}); ${mirror.path} now has that version. Make your change again on top of it.${kept ? ` What you wrote is in ${mirror.path}.unsent.` : ""}`,
    );
    this.record("shared.stale", {
      session: session.id,
      scope: mirror.scope,
      version: answer.current.version,
    });
    return;
  }
  const stashed = await this.stash(mirror);
  const current = await this.host
    .readContext(mirror.workspace, mirror.project, mirror.scope)
    .catch(() => null);
  if (current !== null) await this.mirror(mirror.workspace, current, true);
  else mirror.unsent = false;
  await this.read(session);
  const who =
    answer.keeper === undefined
      ? "Another agent"
      : `${this.host.nameOf(mirror.workspace, answer.keeper.email)}'s agent`;
  session.pending.push(
    `Peer: ${who} keeps the shared context of ${subject} now, so your last change to it was not shared${stashed ? ` (it is in ${mirror.path}.unsent)` : ""}. Your working context is ${session.ownContextPath} again; put what the work should know under "## For the team" there.`,
  );
  this.record("shared.lost", {
    session: session.id,
    scope: mirror.scope,
    keeper: answer.keeper?.session,
  });
}

/**
 * After a view: newer shared contexts are read, a keeper that lost its work's
 * context hears so, one agent here asks to keep a context nobody keeps, and
 * a keeper's unsent change goes again.
 */
export async function followShared(this: CoordinationBroker, workspace: string) {
  const view = this.views.get(workspace);
  // A hub from before shared contexts lists none.
  if (view?.contexts === undefined) return;
  const works = new Map<string, LocalSession[]>();
  for (const session of this.sessions.values()) {
    if (session.workspace !== workspace) continue;
    const key = this.sharedKey(workspace, session.project, scopeOf(session.task));
    works.set(key, [...(works.get(key) ?? []), session]);
  }
  for (const [key, sessions] of works) {
    const first = sessions[0];
    if (first === undefined) continue;
    const scope = scopeOf(first.task);
    const subject = this.subjectOf(workspace, first.project, scope);
    const listed = view.contexts.find((c) => c.project === first.project && c.scope === scope);
    let mirror = this.shared.get(key);
    if (listed !== undefined && listed.version > (mirror?.version ?? -1)) {
      const known = mirror?.version;
      const current = await this.host
        .readContext(workspace, first.project, scope)
        .catch(() => null);
      if (current !== null) mirror = await this.mirror(workspace, current);
      // A version its keeper here did not write: a person brought an older one back.
      const keeping = sessions.find((s) => s.keeps);
      if (
        current !== null &&
        mirror !== undefined &&
        keeping !== undefined &&
        known !== undefined &&
        current.updatedSession !== keeping.id
      ) {
        keeping.sharedHeard = current.version;
        keeping.sharedHeardText = mirror.text;
        const who =
          current.updatedBy === undefined
            ? "Someone"
            : this.host.nameOf(workspace, current.updatedBy);
        keeping.pending.push(
          current.restoredFrom === undefined
            ? `Peer: ${who} changed the shared context you keep (now version ${current.version}); ${mirror.path} has it. Go on from it.`
            : `Peer: ${who} brought version ${current.restoredFrom} of the shared context you keep back (now version ${current.version}); ${mirror.path} has it. Go on from it; what it replaced is version ${known} (\`${this.cli} context ${known}\`).`,
        );
        this.record("shared.replaced", {
          session: keeping.id,
          scope,
          version: current.version,
          restoredFrom: current.restoredFrom,
        });
      }
    }
    if (mirror !== undefined && listed !== undefined) mirror.keeper = listed.keeper;
    for (const session of sessions) {
      if (!session.keeps || listed?.keeper === undefined || listed.keeper.session === session.id) {
        continue;
      }
      await this.read(session);
      session.pending.push(
        `Peer: ${this.host.nameOf(workspace, listed.keeper.email)}'s agent keeps the shared context of ${subject} now. Your working context is ${session.ownContextPath} again; put what the work should know under "## For the team" there.`,
      );
      this.record("shared.lost", { session: session.id, scope, keeper: listed.keeper.session });
    }
    // The hub lists a session of this computer as the keeper that this process does not know to
    // keep it: Peer restarted since it began. It keeps the context again, where it was.
    const email = this.host.email();
    const resumed = sessions.find(
      (s) =>
        !s.keeps &&
        !s.starting &&
        listed?.keeper?.session === s.id &&
        listed.keeper.email === email,
    );
    if (resumed !== undefined) {
      const heard = resumed.sharedHeard;
      await this.takeUp(resumed);
      const back = this.mirrorOf(resumed);
      if (resumed.keeps && back !== undefined) {
        const stashed = await NodeFSP.stat(`${back.path}.unsent`).then(
          () => true,
          () => false,
        );
        // A session whose memory says it kept it, as it is now, knows: it hears only of edits left.
        if (resumed.keptBefore !== scope || back.version !== heard || stashed)
          resumed.pending.push(
            `Peer restarted, and you still keep the shared context of ${subject}: ${back.path} has it (version ${back.version}); go on keeping it there.${stashed ? ` Edits of yours the hub had not taken before are in ${back.path}.unsent.` : ""}`,
          );
        this.record("shared.resumed", { session: resumed.id, scope, version: back.version });
      }
      resumed.keptBefore = undefined;
    }
    const keeper = sessions.find((s) => s.keeps);
    if (keeper !== undefined) {
      // An unsent change goes again; an edit its hooks did not see (through Bash, say) goes too.
      const kept = this.mirrorOf(keeper);
      if (kept?.unsent === true) await this.pushShared(keeper, kept);
      else await this.saveShared(keeper);
      continue;
    }
    // Like the paper's orchestrator, a keeper is an agent at work: one that stopped reporting, or
    // has been idle a while when an agent here works on its work, gives way.
    const keeperSession =
      listed?.keeper === undefined
        ? undefined
        : view.sessions.find((s) => s.id === listed.keeper?.session);
    const idleFor =
      keeperSession === undefined || keeperSession.status === "working"
        ? 0
        : Date.now() - Date.parse(keeperSession.activeAt ?? keeperSession.seenAt);
    const away =
      keeperSession === undefined ||
      (idleFor > KEEPER_IDLE_MS && sessions.some((s) => s.status === "working"));
    if (listed?.keeper !== undefined && !away) continue;
    if (Date.now() - (this.claimedAt.get(key) ?? 0) < CLAIM_GAP_MS) continue;
    this.claimedAt.set(key, Date.now());
    // The agent that kept it before Peer restarted takes it back (its Peer gave it up as it quit);
    // else the agent most at work here takes it over, and one starting takes it up as it starts.
    const next = sessions
      .filter((s) => !s.starting)
      .toSorted(
        (a, b) =>
          Number(b.keptBefore === scope) - Number(a.keptBefore === scope) ||
          Number(b.status === "working") - Number(a.status === "working") ||
          b.lastActivity - a.lastActivity,
      )[0];
    if (next === undefined) continue;
    const heard = next.sharedHeard;
    await this.takeUp(next);
    const kept = this.mirrorOf(next);
    // As it left it: what it would be told of keeping it, it knows.
    const again = next.keptBefore === scope && kept?.version === heard;
    next.keptBefore = undefined;
    if (!next.keeps || kept === undefined) continue;
    const before = listed?.keeper;
    const since = kept.version === 0 ? 0 : Date.parse(kept.updatedAt);
    const findings = findingsOnWork(this.holder(next), this.findingsOf(workspace), next.heard);
    for (const finding of findings) next.heard.add(finding.id);
    next.roster = this.agentsOn(next);
    const fresh = findings.filter((finding) => Date.parse(finding.at) > since).slice(0, 10);
    const told = [
      ...(again
        ? []
        : [
            `Peer: you (${clip(neutral(this.me(next)), 50)}) keep the shared context of ${clip(neutral(subject), 80)} now${before === undefined ? "" : `; ${clip(neutral(this.host.nameOf(workspace, before.email)), 30)}'s agent kept it before`}. Shared v${kept.version}: ${clip(kept.path, 180)}. Read: ${this.cli} context ${this.handleOf(workspace, next.project, scope)}. Private notes stay separate. In ## Provides keep outputs, assumptions and verification; share at subtask boundaries.`,
          ]),
      ...(fresh.length === 0
        ? []
        : [
            findingsForKeeper({
              subject,
              findings: fresh,
              nameOf: this.nameOf(workspace),
              cli: this.cli,
            }),
          ]),
    ];
    if (told.length > 0) next.pending.push(told.join("\n\n"));
    this.record(again ? "shared.resumed" : "shared.handed", {
      session: next.id,
      scope,
      ...(again ? {} : { from: before?.session }),
      version: kept.version,
    });
  }
}
