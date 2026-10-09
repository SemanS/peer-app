// @effect-diagnostics globalDate:off - the age of works' contexts in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The board: the project's other works as an agent can hear of them, which it chooses its
 * context from (the index at its start, discovery at its steps, `peer index`), with what the
 * index source (knowledge's `.ai`) adds, and the copies of their shared contexts this computer
 * keeps for its agents.
 *
 * @module peerHub/core/index/board
 */
import { plural } from "../../peerText.ts";
import type { CoordinationBroker } from "../broker/Broker.ts";
import { commandsOn } from "../broker/cli.ts";
import type { PeerBrokerPlugins } from "../broker/host.ts";
import { messageOf } from "../broker/log.ts";
import type { Advice, LocalSession, SessionIndex } from "../broker/sessions.ts";
import { contextWritten, scopeOf } from "../contexts/text.ts";
import { AGENT_NAMES, type AgentKind, claimedTask, taskClaim } from "../coordination/edits.ts";
import type { HubCoordSession } from "../hub/hubApi.ts";
import type { PeerIndexEntry } from "../plugin.ts";
import {
  ASK_GIST_SHOWN,
  ASK_INDEX_SHOWN,
  askIndexText,
  askReminderText,
  type BoardEntry,
  discoveryKey,
} from "./text.ts";

/** Another work on a project as an agent could hear of it: its board entry and what it says of itself. */
export interface WorkRow {
  readonly entry: BoardEntry;
  /** What its agents were asked and say they do. */
  readonly labels: ReadonlyArray<string>;
  readonly text: string | undefined;
  readonly updatedAt: number | undefined;
  readonly active: boolean;
  readonly working: boolean;
}

/** The other works an agent hears of when it starts; `peer status` lists up to `BOARD_ALL`. */
const BOARD_SHOWN = 8;
export const BOARD_ALL = 30;

/** A work nobody is at counts while its shared context changed this many days ago at most. */
const BOARD_DAYS = 14;

/** The other works' shared contexts this computer keeps a copy of, per project. */
const BOARD_MIRRORS = 12;

/**
 * How long a pause must be before an ask that has nothing new in it is reminded of the others' work
 * (`PEER_ASK_REMIND_MS`, which the lab shortens).
 */
const ASK_REMIND_MS = Number(process.env.PEER_ASK_REMIND_MS) || 10 * 60 * 1000;

/** How long ago a time was, as people say it: `4 min`, `2 h`. */
function sinceText(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (Number.isNaN(minutes)) return "a while";
  if (minutes === 0) return "under a minute";
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

/** A task as people name it, in a project. */
export function taskNamer(this: CoordinationBroker, workspace: string, project: string) {
  return (task: string) => this.host.taskName(workspace, project, task);
}

/** What a work is called: its task's name, or the project's work outside tasks. */
export function subjectOf(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  scope: string,
): string {
  return scope.startsWith("task:")
    ? this.host.taskName(workspace, project, scope.slice("task:".length))
    : `${project} (work outside tasks)`;
}

/** What agents type for a work in `peer context` and `peer ask`: its task's key, else its id. */
export function handleOf(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  scope: string,
): string {
  const task = claimedTask(scope);
  if (task === undefined) return "project";
  return this.host.tasks(workspace, project).find((t) => t.id === task)?.key ?? task;
}

/** The work a handle names in a project: a task by its key or id, or `project`. */
export function scopeNamed(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  handle: string,
): string | undefined {
  const wanted = handle.trim().toLowerCase();
  if (wanted === "project") return "project";
  const task = this.host
    .tasks(workspace, project)
    .find((t) => t.id.toLowerCase() === wanted || t.key?.toLowerCase() === wanted);
  if (task !== undefined) return `task:${task.id}`;
  // A task the hub has a context or agents for that Peer's list of tasks does not have yet.
  const view = this.views.get(workspace);
  const scopes = [
    ...(view?.contexts ?? []).filter((c) => c.project === project).map((c) => c.scope),
    ...(view?.sessions ?? [])
      .filter((s) => s.project === project && s.task !== undefined)
      .map((s) => scopeOf(s.task)),
  ];
  return scopes.find((scope) => claimedTask(scope)?.toLowerCase() === wanted);
}

/** An agent at work elsewhere on the project, as the index shows it: whose, what it does now, and where. */
export function boardAgent(
  this: CoordinationBroker,
  workspace: string,
  other: HubCoordSession,
): string {
  const agent =
    other.agent === undefined ? "" : `${AGENT_NAMES[other.agent as AgentKind] ?? other.agent}, `;
  const doing =
    other.status === "working"
      ? "working"
      : other.status === "blocked"
        ? "waiting for its person"
        : `idle ${sinceText(other.activeAt ?? other.seenAt)}`;
  const where = other.environment === this.host.environment ? "" : ", on another computer";
  // What it changes now says what it builds: the newest files, as far as the hub knows them.
  const files = other.files.slice(-3);
  const at =
    files.length === 0
      ? ""
      : `: ${files.join(", ")}${other.files.length > files.length ? ` (+${other.files.length - files.length})` : ""}`;
  return `${this.host.nameOf(workspace, other.email)}'s agent (${agent}${doing}${where}${at})`;
}

/**
 * The project's other works as an agent on `session`'s could hear of them: each task (or the
 * work outside tasks) with agents at work on it or a recent shared context, and what each says
 * about itself. A closed task, or one whose context nobody wrote lately, says nothing unless
 * agents work on it.
 */
export function works(this: CoordinationBroker, session: LocalSession): WorkRow[] {
  const { workspace, project } = session;
  const view = this.views.get(workspace);
  const own = scopeOf(session.task);
  const others = this.merged(workspace, view).sessions.filter(
    (s) => s.project === project && s.id !== session.id,
  );
  const contexts = (view?.contexts ?? []).filter((c) => c.project === project);
  const unfinished = (this.host.work?.(workspace, project) ?? []).filter(
    (thread) => thread.delivery !== "merged" && thread.delivery !== "closed",
  );
  const done = new Set(
    this.host
      .tasks(workspace, project)
      .filter((t) => t.status === "done")
      .map((t) => `task:${t.id}`),
  );
  const scopes = new Set([
    ...contexts.map((c) => c.scope),
    ...others.map((s) => scopeOf(s.task)),
    ...unfinished.map((thread) => scopeOf(thread.task)),
  ]);
  // Two ordinary threads need not have explicit task assignments to discover each other.
  // Their shared project scope still has a single keeper; never invent tasks from prompt text.
  if (!others.some((other) => scopeOf(other.task) === own)) scopes.delete(own);
  return [...scopes].flatMap((scope) => {
    const context = contexts.find((c) => c.scope === scope);
    const agents = others.filter((s) => scopeOf(s.task) === scope);
    const written = context !== undefined && context.version > 0;
    const recent =
      written && Date.now() - Date.parse(context.updatedAt) < BOARD_DAYS * 24 * 60 * 60 * 1000;
    const pending = unfinished.filter((thread) => scopeOf(thread.task) === scope);
    if (agents.length === 0 && (done.has(scope) || (!recent && pending.length === 0))) return [];
    const mirror = this.shared.get(this.sharedKey(workspace, project, scope));
    const updatedAt = written ? Date.parse(context.updatedAt) : undefined;
    return [
      {
        entry: {
          scope,
          handle: this.handleOf(workspace, project, scope),
          name:
            scope === "project" ? "Work outside tasks" : this.subjectOf(workspace, project, scope),
          agents:
            agents.length > 0
              ? agents.map((s) => this.boardAgent(workspace, s))
              : pending
                  .slice(0, 3)
                  .map(
                    (thread) =>
                      `${this.host.nameOf(workspace, thread.email)}'s unfinished work (${thread.branch ?? thread.title}; runtime unavailable)`,
                  ),
          keeper:
            context?.keeper === undefined
              ? undefined
              : `${this.host.nameOf(workspace, context.keeper.email)}'s agent`,
          version: context?.version,
          gist: context?.gist,
          activity:
            agents.length === 0
              ? undefined
              : `${plural(agents.length, "agent")}: ${agents
                  .slice(0, 2)
                  .map((s) => s.intent || s.label)
                  .join("; ")}`,
          files: [
            ...new Set(
              agents.flatMap((s) =>
                [...s.files, ...s.claims].filter((path) => !path.startsWith("task:")),
              ),
            ),
          ].slice(-3),
          // A copy that is behind the hub's version is no copy of the context the line names.
          path:
            mirror !== undefined && mirror.version > 0 && mirror.version === context?.version
              ? mirror.path
              : undefined,
          updatedAt,
        },
        labels: agents.flatMap((s) => [s.label, s.intent ?? ""]).filter((text) => text !== ""),
        text:
          mirror !== undefined && mirror.version > 0 && contextWritten(mirror.text)
            ? mirror.text
            : undefined,
        updatedAt,
        active: agents.length > 0,
        working: agents.some((s) => s.status === "working"),
      },
    ];
  });
}

/** Works with agents at work on them first, those being worked on now first of those, then the most recently written. */
export function byActivity(a: WorkRow, b: WorkRow): number {
  return (
    Number(b.active) - Number(a.active) ||
    Number(b.working) - Number(a.working) ||
    (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  );
}

/** The project's other works for an agent on `session`'s, in the order of who is at work on them. */
export function board(
  this: CoordinationBroker,
  session: LocalSession,
  limit = BOARD_SHOWN,
): BoardEntry[] {
  return this.works(session)
    .toSorted(byActivity)
    .slice(0, limit)
    .map((row) => row.entry);
}

/** The board with what this agent did with each work: which version of its context it read, whether it asked its agents. */
export function indexWorks(
  this: CoordinationBroker,
  session: LocalSession,
  limit: number,
): BoardEntry[] {
  return this.board(session, limit).map((entry) => {
    const read = session.read.get(entry.scope)?.version;
    const task = claimedTask(entry.scope);
    // Asking a work's agents claims its task while the conversation lasts (`peer ask`).
    const asked = task !== undefined && session.claims.includes(taskClaim(task));
    return {
      ...entry,
      ...(read === undefined ? {} : { read }),
      ...(asked ? { asked: true } : {}),
    };
  });
}

/**
 * The index is advice: whatever goes wrong in it must never break the hook that also carries
 * Peer's decisions (a stopped edit, a note), so it is logged and the hook goes on without it.
 */
export function advise<T>(
  this: CoordinationBroker,
  session: LocalSession,
  what: string,
  run: () => T,
  fallback: T,
): T {
  try {
    return run();
  } catch (error) {
    this.log("index.failed", { session: session.id, what, error: messageOf(error) });
    return fallback;
  }
}

/** Remembers what an agent did with the team's work, for people to see in Peer (the last dozen per agent). */
export function noteAdvice(this: CoordinationBroker, session: LocalSession, entry: Advice) {
  session.advice.push(entry);
  if (session.advice.length > 12) session.advice.splice(0, session.advice.length - 12);
  this.host.changed();
}

/**
 * New work and changed versions, at a prompt or tool boundary. No semantic ranking: the agent
 * chooses using its normal inference. Already-read contexts have their own exact-version
 * notices. Silent steps add nothing; a human prompt after a pause may get a one-line reminder.
 */
export function discoveryFor(
  this: CoordinationBroker,
  session: LocalSession,
  remind = false,
): string | null {
  const works = this.indexWorks(session, Number.POSITIVE_INFINITY);
  if (works.length === 0) return null;
  // Asking alone is not a read and does not unsubscribe the agent from changes.
  const fresh = works.filter((entry) => session.told.get(entry.scope) !== discoveryKey(entry));
  const now = Date.now();
  if (fresh.length === 0) {
    if (!remind || now - session.askIndexAt < ASK_REMIND_MS) return null;
    session.askIndexAt = now;
    this.log("index.asked", { session: session.id, kind: "reminder", works: [] });
    return askReminderText(this.cli);
  }
  const knowledge = session.index.entries.length;
  const changed = session.told.size > 0;
  const text = askIndexText({
    works: fresh,
    changed,
    knowledge: knowledge > 0,
    cli: this.cli,
    on: session.index.on,
  });
  if (text === null) return null;
  // Only the works the block gave the gist of are told: the rest come with the next ask.
  const gisted = fresh.slice(0, ASK_GIST_SHOWN);
  for (const entry of gisted) session.told.set(entry.scope, discoveryKey(entry));
  session.askIndexAt = now;
  this.log("index.asked", {
    session: session.id,
    boundary: remind ? "prompt" : "step",
    kind: changed ? "changed" : "first",
    works: fresh.slice(0, ASK_INDEX_SHOWN).map((entry) => entry.scope),
    told: gisted.map((entry) => entry.scope),
    versions: gisted.map((entry) => ({ scope: entry.scope, version: entry.version ?? 0 })),
    knowledge,
  });
  return text;
}

/**
 * What the active plugins give a session's index now: the index source's entries for its
 * checkout (a read that fails keeps what was read before), and the commands Peer's texts may name.
 */
export async function indexOf(
  this: CoordinationBroker,
  session: LocalSession,
  plugins: PeerBrokerPlugins,
): Promise<SessionIndex> {
  const source = plugins.indexSource;
  const entries =
    source === undefined
      ? []
      : await this.host.run(source.entries(this.sessionView(session))).catch((error: unknown) => {
          this.log("plugin.failed", { hook: "indexSource", reason: messageOf(error) });
          return session.index.entries;
        });
  return { entries, on: commandsOn(plugins) };
}

/** The index source's part of an index (`full` for `peer index`); none should it fail. */
export function indexSection(
  this: CoordinationBroker,
  plugins: PeerBrokerPlugins,
  entries: ReadonlyArray<PeerIndexEntry>,
  shown: number,
  full = false,
): string | null {
  try {
    return plugins.indexSource?.section(entries, shown, full) ?? null;
  } catch (error) {
    this.log("plugin.failed", { hook: "indexSource", reason: messageOf(error) });
    return null;
  }
}

/** Where another work's shared context is, for an agent that needs it, or null when none is written. */
export function contextPointer(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  scope: string,
): string | null {
  const listed = this.views
    .get(workspace)
    ?.contexts?.find((c) => c.project === project && c.scope === scope);
  if (listed === undefined || listed.version === 0) return null;
  const mirror = this.shared.get(this.sharedKey(workspace, project, scope));
  const keeper =
    listed.keeper === undefined
      ? ""
      : `, kept by ${this.host.nameOf(workspace, listed.keeper.email)}'s agent`;
  return `Its shared context (version ${listed.version}${keeper}) is in ${mirror !== undefined && mirror.version > 0 ? mirror.path : "the hub"}; ${this.cli} context ${this.handleOf(workspace, project, scope)} prints it.`;
}

/**
 * Keeps this computer's copies of the project's other works' shared contexts,
 * which its agents read as files, like the paper's agents read the contexts
 * of the agents beside them. A copy is read again only when the hub has a
 * newer version.
 */
export function mirrorBoard(this: CoordinationBroker, workspace: string): Promise<void> {
  // One at a time per workspace: a sync and a session's start may both ask.
  const running = this.boardMirroring.get(workspace);
  if (running !== undefined) return running;
  const run = this.copyBoard(workspace).finally(() => this.boardMirroring.delete(workspace));
  this.boardMirroring.set(workspace, run);
  return run;
}

export async function copyBoard(this: CoordinationBroker, workspace: string) {
  const view = this.views.get(workspace);
  if (view?.contexts === undefined) return;
  const local = [...this.sessions.values()].filter((s) => s.workspace === workspace);
  for (const project of new Set(local.map((s) => s.project))) {
    // Their own work's context: followShared reads it, and its keeper here writes it.
    const theirs = new Set(local.filter((s) => s.project === project).map((s) => scopeOf(s.task)));
    const done = new Set(
      this.host
        .tasks(workspace, project)
        .filter((t) => t.status === "done")
        .map((t) => `task:${t.id}`),
    );
    const wanted = view.contexts
      .filter(
        (c) =>
          c.project === project &&
          c.version > 0 &&
          !theirs.has(c.scope) &&
          !done.has(c.scope) &&
          Date.now() - Date.parse(c.updatedAt) < BOARD_DAYS * 24 * 60 * 60 * 1000,
      )
      .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, BOARD_MIRRORS);
    const stale = wanted.filter((context) => {
      const known = this.shared.get(this.sharedKey(workspace, project, context.scope));
      return known === undefined || known.version < context.version;
    });
    await Promise.all(
      stale.map(async (context) => {
        const current = await this.host
          .readContext(workspace, project, context.scope)
          .catch(() => null);
        if (current === null) return;
        await this.mirror(workspace, current);
        this.log("board.mirrored", {
          workspace,
          project,
          scope: context.scope,
          version: current.version,
        });
      }),
    );
  }
}
