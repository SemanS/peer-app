/**
 * The task page's task context card and its folded details: what the context is and who keeps it,
 * how it stands against the newest handoff, and the branch (bookmark under jj), runtime, handoffs, pull requests and
 * creation of the task. Pure, like the rest of the task page's logic.
 */
import type { summaryOf } from "@t3tools/client-runtime/peer/handoff";
import type { PeerHubStatus, PeerProjectState, PeerWorkPullRequest } from "@t3tools/contracts";

import { projectVcs, refRowLabel } from "../vcsWords";
import { personName, type WorkContextNode, type WorkTaskNode } from "../workTree.logic";
import { hubRecord } from "./taskChats.logic";
import { agoLabel, dateLabel } from "./taskTime.logic";

export type HandoffSummaries = ReturnType<typeof summaryOf>;
export type HandoffSummary = HandoffSummaries[number];

/** The newest handoff package by when it was composed; a tie goes to the higher number. */
function byNewest(a: HandoffSummary, b: HandoffSummary): number {
  return Date.parse(b.composedAt) - Date.parse(a.composedAt) || b.number - a.number;
}

export function newestHandoff(summaries: HandoffSummaries): HandoffSummary | undefined {
  return summaries.toSorted(byNewest)[0];
}

/** Who built a handoff package, as a sentence names them. */
export function handoffAuthor(
  summary: HandoffSummary,
  status: PeerHubStatus,
  workspace: string,
): string {
  if (summary.author === status.email) return summary.source === "agent" ? "Your agent" : "You";
  const name = personName(status, workspace, summary.author);
  return summary.source === "agent" ? `${name}’s agent` : name;
}

export interface TaskContextCard {
  readonly version: number;
  /** "Version 4 · kept by your agent · updated 40 min ago by Ana’s agent". */
  readonly headline: string;
  readonly note: string;
}

/**
 * The task context as a card: its version, who keeps it and who wrote it last, whether it moved on
 * since the newest handoff read it. Undefined until an
 * agent wrote the first version. `me` is the person's own name.
 */
export function contextCard(input: {
  readonly context: WorkContextNode | undefined;
  readonly handoff: HandoffSummary | undefined;
  readonly me: string | undefined;
  /** The agent of the person's own chat that keeps the context, when there is one: "Claude". */
  readonly keeperAgent: string | undefined;
  readonly now: number;
}): TaskContextCard | undefined {
  const { context, handoff, now } = input;
  if (context === undefined || context.version === 0) return undefined;
  const keeper = context.keeper;
  const kept =
    keeper === undefined
      ? "no active keeper"
      : `kept by ${keeper.mine ? `your ${input.keeperAgent ?? "agent"}` : `${keeper.person}’s agent`}`;
  // Said once: the writer is named only when it is not the agent that keeps the context.
  const writer =
    context.updatedBy === undefined || context.updatedBy === keeper?.person
      ? ""
      : context.updatedBy === input.me
        ? " by your agent"
        : ` by ${context.updatedBy}’s agent`;
  const written =
    context.restoredFrom === undefined
      ? `updated ${agoLabel(context.updatedAt, now)}${writer}`
      : `v${context.restoredFrom} brought back ${agoLabel(context.updatedAt, now)}${
          context.updatedBy === undefined ? "" : ` by ${context.updatedBy}`
        }`;
  const read = handoff?.contextVersion ?? null;
  const newer =
    handoff !== undefined && read !== null && context.version > read
      ? ` Newer than handoff #${handoff.number}, which read v${read}.`
      : "";
  return {
    version: context.version,
    headline: `Version ${context.version} · ${kept} · ${written}`,
    note: `The notes every agent on this task reads.${newer}`,
  };
}

/** The moved-on clause of the review callout: "(v3 → v4)" while the context changed after the handoff. */
export function contextMovedOn(
  context: WorkContextNode | undefined,
  handoff: HandoffSummary | undefined,
): { readonly read: number; readonly latest: number } | null {
  const read = handoff?.contextVersion ?? null;
  return read !== null && context !== undefined && context.version > read
    ? { read, latest: context.version }
    : null;
}

export interface TaskDetail {
  readonly label: string;
  readonly value: string;
  readonly mono: boolean;
}

/** A pull request as "#42 open"; "PR" when its address names no number. */
function pullRequestLabel(pr: PeerWorkPullRequest): string {
  const number = /\/pull\/(\d+)(?:$|[/?#])/.exec(pr.url)?.[1];
  return [number === undefined ? "PR" : `#${number}`, pr.state === "unknown" ? undefined : pr.state]
    .filter((part) => part !== undefined)
    .join(" ");
}

/**
 * "#2 waiting for review, #1 earlier" while in review, "#2 accepted" once accepted in review;
 * "Earlier: #2, #1" after.
 */
function handoffsLine(
  summaries: HandoffSummaries,
  inReview: boolean,
  accepted: boolean,
  status: PeerHubStatus,
  workspace: string,
): string {
  const [latest, ...earlier] = summaries.toSorted(byNewest);
  if (latest === undefined) return "None yet";
  const several = new Set(summaries.map((summary) => summary.author)).size > 1;
  const name = (summary: HandoffSummary) =>
    several
      ? `#${summary.number} (${summary.author === status.email ? "you" : personName(status, workspace, summary.author)})`
      : `#${summary.number}`;
  if (!inReview) return `Earlier: ${[latest, ...earlier].map(name).join(", ")}`;
  return [
    `${name(latest)} ${accepted ? "accepted" : "waiting for review"}`,
    earlier.length === 0 ? undefined : `${earlier.map(name).join(", ")} earlier`,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
}

/** "v4 (handoff #2 read v3)": the version there is, and what the newest handoff was built from. */
function contextLine(context: WorkContextNode | undefined, handoff: HandoffSummary | undefined) {
  if (context === undefined || context.version === 0) return "None yet";
  const read = handoff?.contextVersion ?? null;
  if (handoff === undefined || read === null) return `v${context.version}`;
  return read === context.version
    ? `v${context.version} (handoff #${handoff.number} read it)`
    : `v${context.version} (handoff #${handoff.number} read v${read})`;
}

/** The folded details: branch, runtime, handoffs, context version, pull requests, creation. */
export function detailRows(input: {
  readonly task: WorkTaskNode;
  readonly summaries: HandoffSummaries;
  readonly handoff: HandoffSummary | undefined;
  readonly created: { readonly by: string; readonly at: string } | undefined;
  readonly state: PeerProjectState | undefined;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly now: number;
  /** A time of day, written the way the person set their clock. */
  readonly clock: (at: string) => string;
}): ReadonlyArray<TaskDetail> {
  const { task, status } = input;
  const branches = [
    ...new Set(
      task.threads.flatMap((thread) =>
        thread.branch === undefined || thread.branch === "" ? [] : [thread.branch],
      ),
    ),
  ];
  const runtimes = [
    ...new Set(
      task.threads.map((thread) => {
        const where = thread.mine
          ? thread.localEnvironment === true
            ? "this computer"
            : "your other computer"
          : `${thread.person}’s computer`;
        return `${thread.source === "herdr" ? "herdr" : "Peer"} · ${where}`;
      }),
    ),
  ];
  const pullRequests = task.threads.flatMap(
    (thread) => hubRecord(thread, input.state, status)?.pullRequests ?? [],
  );
  return [
    {
      label: refRowLabel(task.threads, projectVcs(input.state?.repositories ?? [])),
      value: branches.length === 0 ? "None yet" : branches.join(", "),
      mono: branches.length > 0,
    },
    {
      label: "Runtime",
      value: runtimes.length === 0 ? "No chat yet" : runtimes.join(", "),
      mono: false,
    },
    // Without the handoff plugin the Hub sends no handoffs, and "none" would claim too much.
    ...(status.handoff === undefined
      ? []
      : [
          {
            label: "Handoffs",
            value: handoffsLine(
              input.summaries,
              task.inReview === true,
              task.accepted !== undefined,
              status,
              input.workspace,
            ),
            mono: false,
          },
        ]),
    { label: "Task context", value: contextLine(task.context, input.handoff), mono: false },
    {
      label: "Pull request",
      value: pullRequests.length === 0 ? "None yet" : pullRequests.map(pullRequestLabel).join(", "),
      mono: false,
    },
    {
      label: "Created",
      value:
        input.created === undefined
          ? "Unknown"
          : `by ${input.created.by} · ${dateLabel(input.created.at, input.now)}, ${input.clock(input.created.at)}`,
      mono: false,
    },
  ];
}
