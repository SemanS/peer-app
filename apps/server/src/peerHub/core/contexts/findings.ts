// @effect-diagnostics globalDate:off - news gaps in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * What an agent hears of its team's work at its next step: findings it has not heard, that the
 * task whose context it keeps was closed, who joined or left that work, and what changed in the
 * shared context it reads.
 *
 * @module peerHub/core/contexts/findings
 */
import type { CoordinationBroker } from "../broker/Broker.ts";
import type { LocalSession } from "../broker/sessions.ts";
import type { HubFinding } from "../hub/coordApi.ts";
import {
  closeOutText,
  contextWritten,
  findingsForKeeper,
  findingsOnWork,
  rosterChange,
  scopeOf,
  sharedChange,
  teamNews,
} from "./text.ts";

/** An agent reading a shared context hears its changes at most this often. */
const SHARED_NEWS_GAP_MS = 5 * 60 * 1000;

export function findingsOf(this: CoordinationBroker, workspace: string): ReadonlyArray<HubFinding> {
  return this.views.get(workspace)?.findings ?? [];
}

/** What other agents found: for a keeper, what its work found; for anyone, what names its files. */
export function findingNews(this: CoordinationBroker, session: LocalSession): string | null {
  const findings = this.findingsOf(session.workspace);
  const parts: string[] = [];
  const delivered: string[] = [];
  if (session.keeps) {
    const onWork = findingsOnWork(this.holder(session), findings, session.heard).slice(0, 8);
    if (onWork.length > 0) {
      parts.push(
        findingsForKeeper({
          subject: this.subjectOf(session.workspace, session.project, scopeOf(session.task)),
          findings: onWork,
          nameOf: this.nameOf(session.workspace),
          cli: this.cli,
        }),
      );
      for (const finding of onWork) {
        session.heard.add(finding.id);
        delivered.push(finding.id);
      }
    }
  }
  const team = teamNews({
    me: this.holder(session),
    findings,
    heard: session.heard,
    // Findings on its own work go to whoever keeps the work's shared context, while somebody does.
    sameWork: !session.keeps && this.keeperOf(session) === undefined,
    nameOf: this.nameOf(session.workspace),
    taskName: (task) => this.host.taskName(session.workspace, session.project, task),
    taskHandle: (task) => this.handleOf(session.workspace, session.project, scopeOf(task)),
    cli: this.cli,
  });
  if (team !== null) {
    parts.push(team.text);
    for (const id of team.ids) {
      session.heard.add(id);
      delivered.push(id);
    }
  }
  if (parts.length === 0) return null;
  const text = parts.join("\n\n");
  this.log("finding.prepared", {
    session: session.id,
    runtimeGeneration: session.runtimeGeneration,
    keeps: session.keeps,
    findings: delivered,
    text,
  });
  return text;
}

/** A keeper whose task was closed is asked, once, to mark what the project should keep. */
export function closeNews(this: CoordinationBroker, session: LocalSession): string | null {
  if (!session.keeps || session.task === undefined || session.toldClosed) return null;
  if (!this.host.taskDone(session.workspace, session.project, session.task)) return null;
  session.toldClosed = true;
  this.log("shared.closed", { session: session.id, task: session.task });
  return closeOutText(this.host.taskName(session.workspace, session.project, session.task));
}

/** Who joined or left the work a keeper keeps the context of, since it last heard. */
export function rosterNews(this: CoordinationBroker, session: LocalSession): string | null {
  if (!session.keeps) return null;
  const now = this.agentsOn(session);
  const before = session.roster;
  session.roster = now;
  // Its start, or the handover, said who was there.
  if (before === undefined) return null;
  return rosterChange(before, now);
}

/** What changed in the shared context a session reads, at most every few minutes. */
export function sharedNews(this: CoordinationBroker, session: LocalSession): string | null {
  if (session.keeps) return null;
  const mirror = this.mirrorOf(session);
  if (
    mirror === undefined ||
    mirror.version <= session.sharedHeard ||
    !contextWritten(mirror.text) ||
    Date.now() - session.sharedToldAt < SHARED_NEWS_GAP_MS
  ) {
    return null;
  }
  const text = sharedChange(
    this.sharedOf(mirror),
    session.sharedHeardText,
    mirror.updatedBy === undefined
      ? undefined
      : this.host.nameOf(mirror.workspace, mirror.updatedBy),
  );
  session.sharedHeard = mirror.version;
  session.sharedHeardText = mirror.text;
  session.sharedToldAt = Date.now();
  this.log("shared.told", {
    session: session.id,
    scope: mirror.scope,
    version: mirror.version,
    text,
  });
  return text;
}
