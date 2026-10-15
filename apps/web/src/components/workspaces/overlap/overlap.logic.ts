/**
 * An overlap as people read it: the two sides (whose agent, on which task, what it changes) and
 * what passed between them, in order. The sidebar's overlap card and the overlap page share it.
 */
import { personName, projectTasks, taskLabel } from "@t3tools/client-runtime/peer/needs-you";
import { effectivePolicy } from "@t3tools/client-runtime/peer-settings";
import {
  OVERLAP_SETTLED_MS,
  PERSON_OVERLAP_RESOLUTION,
  overlapAttention,
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
    const mine = session.email === status.email;
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

/** What passed between the agents: an agent's note, a person's nudge, the agreement. */
export interface OverlapEntry {
  readonly id: string;
  readonly kind: "note" | "nudge" | "agreement";
  /** Who wrote it: "Your agent", "Eva's agent", "You", "Ana". */
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
    (email === status.email
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
      kind: note.session === undefined ? "nudge" : "note",
      who:
        note.session === undefined
          ? note.email === status.email
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
      who:
        overlap.resolution === PERSON_OVERLAP_RESOLUTION
          ? "Closed in Peer"
          : resolvedNote?.session !== undefined
            ? agentName(resolvedNote.session, resolvedNote.email)
            : (closer?.name ?? "The agents"),
      text: overlap.resolution,
      at: overlap.updatedAt,
    });
  }
  return entries;
}

/** Where an overlap stands, as its page's pill says it, in its tone. */
export function overlapState(phase: OverlapAttention): {
  readonly label: string;
  readonly tone: SignalTone;
} {
  switch (phase) {
    case "settled":
      return { label: "Agreed · closed", tone: "delivery" };
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
  return { overlap, phase: overlapAttention(overlap, now) };
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
