// @effect-diagnostics globalDate:off - how long an agent has been idle in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The board: who works on what in a project besides a session's own work, which `peer status`,
 * `peer index` and a session's start read.
 *
 * @module peerHub/core/index/board
 */
import { plural } from "../../peerText.ts";
import type { CoordinationBroker } from "../broker/Broker.ts";
import type { LocalSession } from "../broker/sessions.ts";
import { AGENT_NAMES, type AgentKind } from "../coordination/edits.ts";
import type { HubCoordSession } from "../hub/coordApi.ts";
import type { BoardEntry } from "./text.ts";

/** `peer status` lists up to this many works. */
export const BOARD_ALL = 30;

const scopeOf = (task: string | undefined) => (task === undefined ? "project" : `task:${task}`);

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

/** The task a key or id names in a project's log (`peer log --task`). */
export function taskNamed(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  handle: string,
): string | undefined {
  const wanted = handle.trim().toLowerCase();
  return this.host
    .tasks(workspace, project)
    .find((t) => t.id.toLowerCase() === wanted || t.key?.toLowerCase() === wanted)?.id;
}

/** An agent at work elsewhere on the project: whose, what it does now, and where. */
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

interface WorkRow {
  readonly entry: BoardEntry;
  readonly working: boolean;
}

/**
 * The project's other works as an agent on `session`'s could hear of them: each task (or the work
 * outside tasks) with agents at work on it, or with work nobody finished. Those with agents at work
 * come first, those being worked on now first of those.
 */
function works(this: CoordinationBroker, session: LocalSession): WorkRow[] {
  const { workspace, project } = session;
  const others = this.merged(workspace, this.views.get(workspace)).sessions.filter(
    (s) => s.project === project && s.id !== session.id,
  );
  const unfinished = (this.host.work?.(workspace, project) ?? []).filter(
    (thread) => thread.delivery !== "merged" && thread.delivery !== "closed",
  );
  const own = scopeOf(session.task);
  const scopes = new Set([
    ...others.map((s) => scopeOf(s.task)),
    ...unfinished.map((thread) => scopeOf(thread.task)),
  ]);
  // The session's own task is no other work, whoever else is on it: `peer status` names them. Two
  // ordinary threads need not be on a task to hear of each other, so the work outside tasks stays
  // while another agent is at it.
  if (session.task !== undefined || !others.some((other) => scopeOf(other.task) === own))
    scopes.delete(own);
  const done = new Set(
    this.host
      .tasks(workspace, project)
      .filter((t) => t.status === "done")
      .map((t) => `task:${t.id}`),
  );
  return [...scopes].flatMap((scope) => {
    const agents = others.filter((s) => scopeOf(s.task) === scope);
    const pending = unfinished.filter((thread) => scopeOf(thread.task) === scope);
    if (agents.length === 0 && done.has(scope)) return [];
    const task = scope === "project" ? undefined : scope.slice("task:".length);
    return [
      {
        working: agents.some((s) => s.status === "working"),
        entry: {
          scope,
          handle:
            task === undefined
              ? "project"
              : (this.host.tasks(workspace, project).find((t) => t.id === task)?.key ?? task),
          name:
            task === undefined
              ? "Work outside tasks"
              : this.host.taskName(workspace, project, task),
          agents:
            agents.length > 0
              ? agents.map((s) => this.boardAgent(workspace, s))
              : pending
                  .slice(0, 3)
                  .map(
                    (thread) =>
                      `${this.host.nameOf(workspace, thread.email)}'s unfinished work (${thread.branch ?? thread.title}; runtime unavailable)`,
                  ),
          activity:
            agents.length === 0
              ? undefined
              : `${plural(agents.length, "agent")}: ${agents
                  .slice(0, 2)
                  .map((s) => s.intent || s.label)
                  .join("; ")}`,
          files: [...new Set(agents.flatMap((s) => [...s.files, ...s.claims]))].slice(-3),
        },
      },
    ];
  });
}

/** The project's other works for an agent on `session`'s, in the order of who is at work on them. */
export function board(
  this: CoordinationBroker,
  session: LocalSession,
  limit: number,
): BoardEntry[] {
  return works
    .call(this, session)
    .toSorted(
      (a, b) =>
        Number(b.entry.agents.length > 0) - Number(a.entry.agents.length > 0) ||
        Number(b.working) - Number(a.working),
    )
    .slice(0, limit)
    .map((row) => row.entry);
}
