import { overlapTopic, personName } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { ProjectSignal } from "../slots.types";
import {
  openKey,
  type WorkProjectNode,
  type WorkTaskNode,
  type WorkThreadNode,
} from "../workTree.logic";

/** What Peer knows around a thread that waits on the person: its task and the team's signals. */
export interface ApprovalSignals {
  readonly project: {
    readonly workspace: string;
    readonly projectId: string;
    readonly name: string;
  };
  readonly task: WorkTaskNode | undefined;
  /** Open overlaps between one of the person's agents and a colleague's, on this project. */
  readonly overlaps: ReadonlyArray<{
    readonly id: string;
    readonly topic: string;
    /** The colleague whose agent is on the same files. */
    readonly with: string | undefined;
  }>;
  /** What other agents hold in the project, as the resources signal says it. */
  readonly held: string | undefined;
}

/**
 * The Peer context of one of this computer's threads (`threadKey` = `<environment>:<thread>`):
 * its project and task in the work tree, the project's open overlaps with the person's agents, and
 * the held resources from the project's signals. Null outside a Peer workspace project.
 */
export function approvalSignals(input: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly status: PeerHubStatus;
  readonly threadKey: string;
  /** The signals of the thread's project (core and plugins), from which held resources come. */
  readonly signals: (project: WorkProjectNode) => ReadonlyArray<ProjectSignal>;
}): ApprovalSignals | null {
  const { tree, status, threadKey } = input;
  const matches = (thread: WorkThreadNode) =>
    thread.open !== undefined && openKey(thread.open) === threadKey;
  for (const project of tree) {
    const task = project.areas
      .flatMap((area) => area.tasks)
      .find((candidate) => candidate.threads.some(matches));
    if (task === undefined && !project.unsorted.some(matches)) continue;
    const mine = new Set(
      status.coordination.sessions
        .filter(
          (session) =>
            session.email === status.email &&
            session.workspace === project.workspace &&
            session.project === project.projectId,
        )
        .map((session) => session.id),
    );
    const overlaps = status.coordination.enabled
      ? status.coordination.overlaps
          .filter(
            (overlap) =>
              overlap.state === "open" &&
              overlap.workspace === project.workspace &&
              overlap.project === project.projectId &&
              overlap.sessions.some((session) => mine.has(session)),
          )
          .map((overlap) => {
            const other = status.coordination.sessions.find(
              (session) => overlap.sessions.includes(session.id) && !mine.has(session.id),
            );
            return {
              id: overlap.id,
              topic: overlapTopic(status, overlap),
              with:
                other === undefined
                  ? undefined
                  : personName(status, project.workspace, other.email),
            };
          })
      : [];
    const held = input.signals(project).find((signal) => signal.id === "resources");
    return {
      project: { workspace: project.workspace, projectId: project.projectId, name: project.name },
      task,
      overlaps,
      held: held !== undefined && held.count !== null && held.count > 0 ? held.detail : undefined,
    };
  }
  return null;
}

/** The line an answer gets when the person marks it as a project decision. */
export const PROJECT_DECISION_LINE = "Record this decision in your context marked [project].";

/** The answer as the agent gets it: the person's words, and the request to record the decision. */
export function answerWithDecision(text: string, checked: boolean): string {
  return checked ? `${text.trimEnd()}\n\n${PROJECT_DECISION_LINE}` : text;
}

/**
 * Deny with a note: the approval is declined first, and only once that worked does the note go to
 * the agent as the person's next message. An empty note sends nothing.
 */
export async function denyWithNote(
  note: string,
  steps: {
    /** Declines the approval; false when it did not go through. */
    readonly decline: () => Promise<boolean>;
    readonly send: (note: string) => Promise<void>;
  },
): Promise<boolean> {
  const text = note.trim();
  if (text === "") return false;
  if (!(await steps.decline())) return false;
  await steps.send(text);
  return true;
}
