/**
 * What the Changes page decides before it draws: which route the sidebar marks, who waits for the
 * person's review, which teammates work on Git, how the graph's lines run and how an inspector
 * says who may rewrite a change. The graph itself (lanes, shapes, honest states) is the client
 * runtime's; nothing here runs jj.
 */
import {
  changeKeyAndTitle,
  olderBaseWords,
  type ChangeInspectorModel,
  type GitTeammate,
  type GraphRow,
  type OlderBase,
} from "@t3tools/client-runtime/peer/changes";
import { agentName, personName } from "@t3tools/client-runtime/peer/jujutsu";
import { agoInWords, taskOwnership } from "@t3tools/client-runtime/peer/work";
import type { ChangeRow, LandedChange, PeerChangesStatus } from "@t3tools/contracts";

import type { WorkProjectNode, WorkTaskNode } from "../workTree.logic";

/** The route the sidebar marks while the Changes page is open, in `workTree` terms. */
export const changesRouteKey = (workspace: string, project: string): string =>
  `changes:${workspace}:${project}`;

/**
 * Changes that hold a conflict or two versions: the navigation row's count, as the Hub-facing
 * status counts them. Forecast results never count here (they live on the preview).
 */
export function needAttentionOf(
  status: { readonly changes?: PeerChangesStatus | undefined },
  workspace: string,
  project: string,
): number {
  return (
    status.changes?.projects.find(
      (entry) => entry.workspace === workspace && entry.project === project,
    )?.needAttention ?? 0
  );
}

const keyEquals = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

const allTasks = (node: WorkProjectNode | undefined): ReadonlyArray<WorkTaskNode> =>
  node === undefined ? [] : node.areas.flatMap((area) => area.tasks);

/** The task a change belongs to: its report's task, else the key in its subject. */
export function taskOfChange(
  node: WorkProjectNode | undefined,
  row: ChangeRow,
): WorkTaskNode | undefined {
  const reported = row.task;
  const { key } = changeKeyAndTitle(row);
  return allTasks(node).find(
    (task) =>
      (reported !== undefined && task.id === reported) || keyEquals(task.key, key ?? reported),
  );
}

/**
 * The changes that wait for the person's first review: those of a task in review whose review asks
 * this person (the owner, or the leads, or everyone when the project has no ownership), written by
 * somebody else. A change they marked and that moved since is `awaitsReview`'s other half.
 */
export function awaitingReviewIds(
  node: WorkProjectNode | undefined,
  changes: ReadonlyArray<ChangeRow>,
  me: string | null | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (node === undefined) return ids;
  for (const area of node.areas) {
    for (const task of area.tasks) {
      // An accepted handoff (by a lead or by the review policy) asks nobody's review.
      if (task.inReview !== true || task.accepted !== undefined) continue;
      const route = taskOwnership(node, task, area.name).review;
      if (route !== undefined && !route.forMe) continue;
      for (const row of changes) {
        if (taskOfChange(node, row)?.id !== task.id) continue;
        if (
          me !== null &&
          me !== undefined &&
          row.author.email.toLowerCase() === me.toLowerCase()
        ) {
          continue;
        }
        ids.add(row.changeId);
      }
    }
  }
  return ids;
}

/**
 * Teammates whose checkout is Git: their threads show by branch, since a branch has no change ids.
 * One line per person and branch; this person's own threads are the graph's.
 */
export function gitTeammates(node: WorkProjectNode | undefined): ReadonlyArray<GitTeammate> {
  if (node === undefined) return [];
  const threads = [
    ...node.unsorted.map((thread) => ({ thread, task: undefined as string | undefined })),
    ...node.areas.flatMap((area) =>
      area.tasks.flatMap((task) => task.threads.map((thread) => ({ thread, task: task.key }))),
    ),
  ];
  const seen = new Set<string>();
  const result: GitTeammate[] = [];
  for (const { thread, task } of threads) {
    if (thread.mine || thread.stale || thread.vcs === "jj" || thread.branch === undefined) continue;
    if (thread.email === undefined) continue;
    const id = `${thread.email}\u0000${thread.branch}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      email: thread.email,
      ...(thread.harness === undefined ? {} : { agent: thread.harness }),
      ...(task === undefined ? {} : { task }),
      branch: thread.branch,
    });
  }
  return result;
}

/** What the inspector says about who can rewrite a change. */
export function rewriteLine(input: {
  readonly row: ChangeRow | undefined;
  readonly mine: boolean;
}): string {
  const { row, mine } = input;
  if (row === undefined) return "Nobody. jj keeps landed changes immutable in every workspace.";
  const agent = agentName(row.author.agent);
  if (mine) return `Only your ${agent}, which made it, and you in a terminal.`;
  const person = personName(row.author.email);
  return `Only ${person}'s ${agent}, which made it, and ${person} in a terminal. Every other agent's workspace has it read-only, and jj refuses their rewrites.`;
}

/** The landed row's own words, since trunk's newest change has no session behind it. */
export function landedRow(landed: LandedChange, now: number) {
  const at = landed.at === undefined ? Number.NaN : Date.parse(landed.at);
  const when = Number.isFinite(at) ? ` ${agoInWords(at, now)}` : "";
  const who = landed.author === undefined ? "" : `${personName(landed.author)} · `;
  return {
    title: `${landed.subject} (landed)`,
    who: `${who}landed${when} · ${landed.bookmark}`,
    key: landed.bookmark.split("@")[0] ?? "main",
  };
}

/** Which row is selected: the person's pick while it is still in the graph, else the first change. */
export function selectedId(
  rows: ReadonlyArray<GraphRow>,
  picked: string | undefined,
): string | undefined {
  if (picked !== undefined && rows.some((row) => row.id === picked)) return picked;
  return (rows.find((row) => row.kind === "change") ?? rows[0])?.id;
}

/** Geometry of the lane drawing: one fixed-height cell per row, so the lines of rows meet. */
export const GRAPH = { row: 72, lane: 24, margin: 14, node: 36 } as const;

export const laneX = (lane: number): number => GRAPH.margin + lane * GRAPH.lane;

export interface RowDrawing {
  readonly width: number;
  readonly lines: ReadonlyArray<string>;
  readonly node: { readonly x: number; readonly y: number };
}

/**
 * The lines of one graph row: lanes that pass through, lanes that end at the node from above, the
 * node's own line down, and where a merge or a head joins a lane that is already open. Curves
 * leave and enter vertically, so a lane drawn by consecutive rows has no corner.
 */
export function rowDrawing(row: GraphRow, lanes: number): RowDrawing {
  const { row: height, node: y } = GRAPH;
  const x = laneX(row.lane);
  const lines: string[] = [];
  for (const lane of row.through) lines.push(`M${laneX(lane)} 0V${height}`);
  if (row.fromAbove) lines.push(`M${x} 0V${y}`);
  for (const lane of row.closing) {
    lines.push(`M${laneX(lane)} 0C${laneX(lane)} ${y} ${x} 0 ${x} ${y}`);
  }
  if (row.continues) lines.push(`M${x} ${y}V${height}`);
  for (const join of row.joins) {
    const to = laneX(join.to);
    lines.push(`M${x} ${y}C${x} ${height} ${to} ${y} ${to} ${height}`);
  }
  return { width: GRAPH.margin * 2 + Math.max(0, lanes - 1) * GRAPH.lane, lines, node: { x, y } };
}

/** "6 versions since 14:40 · last 1 min ago · you marked version 5 reviewed". */
export function versionsLine(
  versions: {
    readonly count: number;
    readonly since: string | undefined;
    readonly lastAgo: string | undefined;
    readonly marked: number | undefined;
  },
  clock: (at: string) => string,
): string {
  return [
    `${versions.count} ${versions.count === 1 ? "version" : "versions"}${versions.since === undefined ? "" : ` since ${clock(versions.since)}`}`,
    ...(versions.lastAgo === undefined ? [] : [`last ${versions.lastAgo}`]),
    ...(versions.marked === undefined ? [] : [`you marked version ${versions.marked} reviewed`]),
  ].join(" · ");
}

/** Where a change lives, in the inspector's header: the person and agent, and the computers. */
export function whereLine(who: string, environments: ReadonlyArray<string>): string {
  return environments.length === 0 ? who : `${who}, on ${environments.join(" and ")}`;
}

/** "ORD-11", or "ORD-11 and ORD-14": the changes in flight the selected one builds on. */
export function buildsOnLine(model: Pick<ChangeInspectorModel, "buildsOn">): string {
  const [first, ...rest] = model.buildsOn;
  return rest.length === 0
    ? (first ?? "")
    : `${[first, ...rest.slice(0, -1)].join(", ")} and ${rest.at(-1)}`;
}

/**
 * What a base that moved on means: the change still sits on an older version of it until its
 * agent's next tool step, when Peer's follow fetch moves it; a person can also move it with
 * `peer follow`. Said under "Builds on" in the inspector.
 */
export function olderBaseLine(base: OlderBase): string {
  return `Still ${olderBaseWords(base)} of ${base.key}, which moved on. Peer moves it onto the newest at the agent's next tool step.`;
}
