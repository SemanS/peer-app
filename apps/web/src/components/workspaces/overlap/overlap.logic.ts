/**
 * An overlap as people read it: the two sides (whose agent, on which task, what it changes) and
 * what passed between them, in order. The sidebar's overlap card and the overlap page share it.
 */
import { personName, projectTasks, taskLabel } from "@t3tools/client-runtime/peer/needs-you";
import { effectivePolicy } from "@t3tools/client-runtime/peer-settings";
import {
  CLOSED_AFTER_AGENTS_ENDED,
  PEER_LOCAL_WORKSPACE,
  OVERLAP_SETTLED_MS,
  PERSON_OVERLAP_RESOLUTION,
  closedAfterAgentsEnded,
  isSettleHandover,
  overlapAttention,
  overlapHandover,
  overlapLastProposal,
  type OverlapAttention,
  type PeerHubStatus,
  type PeerOverlap,
  type PeerWorkStatus,
} from "@t3tools/contracts";

import type { SignalTone } from "../signals";
import type { WorkProjectNode, WorkThreadNode } from "../workTree.logic";

/** One side of an overlap. */
export interface OverlapSide {
  readonly session: string;
  /** "Your agent", "Eva's agent", or an agent that no longer reports. */
  readonly name: string;
  /** Its person, as the project names them; undefined once the session is gone. */
  readonly person: string | undefined;
  readonly mine: boolean;
  /** The session no longer reports to the hub. */
  readonly gone: boolean;
  /** Its task, or what its session is called when it is on none. */
  readonly on: string | undefined;
  /** The overlap's files it changed, and those it is about to change. */
  readonly files: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  readonly status: PeerWorkStatus | undefined;
}

export function overlapSides(
  status: PeerHubStatus,
  overlap: PeerOverlap,
): ReadonlyArray<OverlapSide> {
  const tasks = projectTasks(status, overlap);
  // A path ending in `/` is a directory: it covers every file under it, either way round.
  const covers = (a: string, b: string) => a === b || (a.endsWith("/") && b.startsWith(a));
  const shared = (paths: ReadonlyArray<string>) =>
    paths.filter((path) => overlap.files.some((file) => covers(file, path) || covers(path, file)));
  const sides = overlap.sessions.map((id): OverlapSide => {
    const session = status.coordination.sessions.find(
      (s) => s.id === id && s.workspace === overlap.workspace && s.project === overlap.project,
    );
    if (session === undefined) {
      return {
        session: id,
        name: "An agent no longer at work",
        person: undefined,
        mine: false,
        gone: true,
        on: undefined,
        files: [],
        claims: [],
        status: undefined,
      };
    }
    const mine = overlap.workspace === PEER_LOCAL_WORKSPACE || session.email === status.email;
    const person = personName(status, overlap.workspace, session.email);
    const task = tasks.find((candidate) => candidate.id === session.task);
    return {
      session: id,
      name: mine ? "Your agent" : `${person}’s agent`,
      person,
      mine,
      gone: false,
      on: task === undefined ? session.label : taskLabel(task),
      files: shared(session.files),
      claims: shared(session.claims),
      status: session.status,
    };
  });
  // Yours first, as people read an overlap from where they stand.
  return sides.sort((a, b) => Number(b.mine) - Number(a.mine));
}

/**
 * What passed between the agents: an agent's note, a person's nudge, Peer's handover of an overlap
 * no agent could close, the agreement.
 */
export interface OverlapEntry {
  readonly id: string;
  readonly kind: "note" | "nudge" | "handover" | "agreement";
  /** Who wrote it: "Your agent", "Eva's agent", "You", "Ana", "Peer". */
  readonly who: string;
  readonly text: string;
  readonly at: string;
}

/**
 * The notes between an overlap's agents in the order they were written. A note without a session
 * is a person's nudge; the resolution that closed it is the agreement, last.
 */
export function overlapConversation(
  status: PeerHubStatus,
  overlap: PeerOverlap,
): ReadonlyArray<OverlapEntry> {
  const sides = overlapSides(status, overlap);
  const agentName = (session: string | undefined, email: string) =>
    sides.find((side) => side.session === session && !side.gone)?.name ??
    (overlap.workspace === PEER_LOCAL_WORKSPACE || email === status.email
      ? "Your agent"
      : `${personName(status, overlap.workspace, email)}’s agent`);
  // The Hub writes the resolution as a note too ("Resolved: …", by whoever closed it). The
  // agreement entry stands for it, under that author's name: `closer` is only the agent that was
  // asked to close it, and the other agent may have been first.
  const resolvedNote =
    overlap.state === "resolved" && overlap.resolution !== undefined
      ? overlap.notes.findLast((note) => note.text === `Resolved: ${overlap.resolution}`)
      : undefined;
  const entries: OverlapEntry[] = [...overlap.notes]
    .filter((note) => note !== resolvedNote)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
    .map((note) => ({
      id: note.id,
      // The handover is written under the person's own address (their Peer said it), so without
      // this it would read as something the person wrote.
      kind:
        note.session !== undefined ? "note" : isSettleHandover(note.text) ? "handover" : "nudge",
      who:
        note.session === undefined
          ? isSettleHandover(note.text)
            ? "Peer"
            : overlap.workspace === PEER_LOCAL_WORKSPACE || note.email === status.email
              ? "You"
              : personName(status, overlap.workspace, note.email)
          : agentName(note.session, note.email),
      text: note.text,
      at: note.at,
    }));
  if (overlap.state === "resolved" && overlap.resolution !== undefined) {
    const closer = sides.find((side) => side.session === overlap.closer && !side.gone);
    entries.push({
      id: `${overlap.id}:agreement`,
      kind: "agreement",
      who: closedInPeer(overlap.resolution)
        ? "Closed in Peer"
        : resolvedNote?.session !== undefined
          ? agentName(resolvedNote.session, resolvedNote.email)
          : (closer?.name ?? "Peer"),
      text: overlap.resolution,
      at: overlap.updatedAt,
    });
  }
  return entries;
}

/** A person closed it in Peer, plainly or with what the agents last proposed once they ended. */
function closedInPeer(resolution: string | undefined): boolean {
  return (
    resolution === PERSON_OVERLAP_RESOLUTION ||
    (resolution?.startsWith(CLOSED_AFTER_AGENTS_ENDED) ?? false)
  );
}

/** What the page says when it has no overlap to show: it is closed, or this computer is not looking. */
export function overlapMissingLine(coordinationOn: boolean): string {
  return coordinationOn
    ? "This overlap is closed. What the agents agreed stays in the project's History."
    : "Agent coordination is off on this computer, so Peer shows no overlaps here. Turn it on to see this one.";
}

/** Where an overlap stands, as its page's pill says it, in its tone. */
export function overlapState(
  phase: OverlapAttention,
  resolution?: string,
): {
  readonly label: string;
  readonly tone: SignalTone;
} {
  switch (phase) {
    case "settled":
      // A person who closed it did not make the agents agree.
      return {
        label: closedInPeer(resolution) ? "Closed in Peer" : "Closed",
        tone: "delivery",
      };
    case "requested":
      return { label: "Waiting for agreement", tone: "coordination" };
    case "unanswered":
      return { label: "No answer yet", tone: "needs" };
    case "recent":
      return { label: "Agents are talking", tone: "coordination" };
    case "decide":
      return { label: "Needs your decision", tone: "needs" };
    case "quiet":
      return { label: "Open", tone: "coordination" };
  }
}

/** Who has agents ask their person before they settle an overlap: the project, or this computer. */
export type OverlapAsker = "project" | "computer" | "unknown";

/**
 * Who set the policy that has this overlap decided by its person. The project does when the Hub
 * says its policy or a path rule decided; otherwise it is the project's own policy where it sets
 * one, else this computer's default. Unknown while the Hub's view of the workspace is not known.
 */
export function overlapAsker(
  coordination: PeerHubStatus["coordination"],
  overlap: Pick<PeerOverlap, "workspace" | "project" | "decision">,
): OverlapAsker {
  if (overlap.workspace === PEER_LOCAL_WORKSPACE) return "computer";
  if (overlap.decision?.source === "project") return "project";
  const policies = coordination.policies?.[overlap.workspace];
  if (policies === undefined) return "unknown";
  return effectivePolicy(policies, overlap.project, coordination.policy).source === "project"
    ? "project"
    : "computer";
}

/** What the page says while the overlap waits for its person: never the project when this computer asks. */
export function decideLine(asker: OverlapAsker): string {
  switch (asker) {
    case "project":
      return "This project asks you before its agents settle an overlap.";
    case "computer":
      return "Your agent asks you before it settles this overlap.";
    case "unknown":
      return "Peer asks you before the agents settle this overlap.";
  }
}

/** The overlap a page shows: still open, or settled a moment ago. */
export function findOverlap(
  status: PeerHubStatus,
  place: { readonly workspace: string; readonly project: string; readonly overlap: string },
  now: number,
): { readonly overlap: PeerOverlap; readonly phase: OverlapAttention } | undefined {
  const overlap = status.coordination.overlaps.find(
    (candidate) =>
      candidate.workspace === place.workspace &&
      candidate.project === place.project &&
      candidate.id === place.overlap,
  );
  if (overlap === undefined) return undefined;
  if (overlap.state === "resolved" && now - Date.parse(overlap.updatedAt) >= OVERLAP_SETTLED_MS) {
    // Long settled: its agreement stays in the project's History.
    return { overlap, phase: "settled" };
  }
  return { overlap, phase: overlapAttention(overlap, now, overlapAtWork(status, overlap)) };
}

/**
 * The overlap's sessions that still report in its project: the rest ended. Without this the page
 * would wait for agents it already shows as gone.
 */
export function overlapAtWork(status: PeerHubStatus, overlap: PeerOverlap): ReadonlyArray<string> {
  return overlap.sessions.filter((id) =>
    status.coordination.sessions.some(
      (session) =>
        session.id === id &&
        session.workspace === overlap.workspace &&
        session.project === overlap.project,
    ),
  );
}

/**
 * Where an open overlap stands now that agents may have ended (design D6): Peer resuming one of
 * them, Peer having handed it to the person, both gone, one gone while the other closes it, or
 * both at work as before.
 */
export type OverlapEnd =
  | { readonly kind: "agents" }
  | { readonly kind: "one-gone"; readonly ended: string; readonly closer: string }
  | { readonly kind: "both-gone" }
  | { readonly kind: "resuming"; readonly agent: string; readonly since: string }
  | { readonly kind: "handed-over" };

/**
 * Whose agent a session was, from the notes it wrote: an ended session no longer reports its
 * person, but its notes still carry their address.
 */
function sessionAgentName(status: PeerHubStatus, overlap: PeerOverlap, session: string): string {
  const side = overlapSides(status, overlap).find(
    (candidate) => candidate.session === session && !candidate.gone,
  );
  if (side !== undefined) return side.name;
  const email = overlap.notes.find((note) => note.session === session)?.email;
  if (email === undefined) return "The other agent";
  return overlap.workspace === PEER_LOCAL_WORKSPACE || email === status.email
    ? "Your agent"
    : `${personName(status, overlap.workspace, email)}’s agent`;
}

/** "Your agent" inside a sentence. */
const midSentence = (name: string) => name.replace(/^(Your|The) /, (word) => word.toLowerCase());

export function overlapEnd(
  status: PeerHubStatus,
  overlap: PeerOverlap,
  phase: OverlapAttention,
): OverlapEnd {
  if (phase === "settled") return { kind: "agents" };
  const attempt = status.settle?.attempts.find(
    (candidate) =>
      candidate.overlap === overlap.id &&
      candidate.workspace === overlap.workspace &&
      candidate.project === overlap.project,
  );
  if (attempt !== undefined) {
    return {
      kind: "resuming",
      agent: sessionAgentName(status, overlap, attempt.session),
      since: attempt.since,
    };
  }
  const atWork = overlapAtWork(status, overlap);
  // Only "decide" is the person's to close: someone asking again after a handover waits as before.
  if (phase === "decide") {
    const handover = overlapHandover(overlap.notes);
    const inForce =
      handover !== undefined &&
      overlap.notes
        .slice(overlap.notes.indexOf(handover) + 1)
        .every((note) => note.session === undefined);
    if (inForce) return { kind: "handed-over" };
    if (atWork.length === 0) return { kind: "both-gone" };
  }
  const ended = overlap.sessions.find((session) => !atWork.includes(session));
  const closer = atWork[0];
  if (
    ended !== undefined &&
    closer !== undefined &&
    atWork.length === overlap.sessions.length - 1
  ) {
    return {
      kind: "one-gone",
      ended: sessionAgentName(status, overlap, ended),
      closer: sessionAgentName(status, overlap, closer),
    };
  }
  return { kind: "agents" };
}

/** What the page offers for an overlap in its phase and end. */
export interface OverlapControls {
  /** The waiting line, where the end says more than the phase; otherwise the phase's own line. */
  readonly line: string | undefined;
  /** "Request agreement" (or "Ask again", "Waiting for the agents") shows. */
  readonly request: boolean;
  /** How "Close it" shows, if it does: the person's move, or the way out nobody answered. */
  readonly close: { readonly label: string; readonly primary: boolean } | undefined;
  /** Peer is resuming an agent: nothing the person does should race it. */
  readonly frozen: boolean;
  /** With nobody left to ask, a message is a note on the overlap, not part of a request. */
  readonly messageAsNote: boolean;
}

export function overlapControls(end: OverlapEnd, phase: OverlapAttention): OverlapControls {
  const unanswered =
    phase === "unanswered" ? { label: "Close it yourself", primary: false } : undefined;
  if (phase === "settled") {
    return {
      line: undefined,
      request: false,
      close: undefined,
      frozen: false,
      messageAsNote: false,
    };
  }
  switch (end.kind) {
    case "resuming":
      return {
        line: `Resuming ${midSentence(end.agent)} to settle this overlap…`,
        request: true,
        close: unanswered,
        frozen: true,
        messageAsNote: false,
      };
    case "handed-over":
      return {
        line: "Peer could not resume the agent that was to close this. It is yours to close.",
        request: false,
        close: { label: "Close it", primary: true },
        frozen: false,
        messageAsNote: true,
      };
    case "both-gone":
      return {
        line: "Both agents ended. Close it with what they last proposed.",
        request: false,
        close: { label: "Close it", primary: true },
        frozen: false,
        messageAsNote: true,
      };
    case "one-gone":
      return {
        // A person's request or the policy's question says more than who ended.
        line:
          phase === "recent" || phase === "quiet"
            ? `${end.ended} ended. ${end.closer} closes it.`
            : undefined,
        request: true,
        close: unanswered,
        frozen: false,
        messageAsNote: false,
      };
    case "agents":
      return {
        line: undefined,
        request: true,
        close: unanswered,
        frozen: false,
        messageAsNote: false,
      };
  }
}

/**
 * What a person's closing records: once the agents ended, what they last proposed, so History
 * keeps it; otherwise the plain "closed by a person".
 */
export function overlapCloseResolution(end: OverlapEnd, overlap: PeerOverlap): string {
  return end.kind === "handed-over" || end.kind === "both-gone"
    ? closedAfterAgentsEnded(
        // In the order written, as the conversation shows them: the Hub's order is not promised.
        overlapLastProposal([...overlap.notes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))),
      )
    : PERSON_OVERLAP_RESOLUTION;
}

/** The thread of a side's agent in the project's tree, when its agent runs in herdr. */
export function sideThread(
  project: WorkProjectNode | undefined,
  session: string,
): WorkThreadNode | undefined {
  if (project === undefined) return undefined;
  const threads = [
    ...project.areas.flatMap((area) => area.tasks.flatMap((task) => task.threads)),
    ...project.unsorted,
  ];
  return threads.find((thread) => /(?:^|:)herdr:(.+)$/.exec(thread.key)?.[1] === session);
}
