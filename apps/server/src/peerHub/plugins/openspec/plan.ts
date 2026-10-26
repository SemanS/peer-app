/**
 * "Update my tasks from the current OpenSpec": what would change, as a list a person confirms item
 * by item. Pure: the plan is made from what Peer read, and applying it re-reads each item's basis.
 *
 * @module peerHub/plugins/openspec/plan
 */
import type { PeerBriefLink, PeerTask } from "@t3tools/contracts";

import { plain } from "../../peerText.ts";

export type PlanKind = "link" | "refresh" | "relink" | "unlink" | "close" | "create";

export interface PlanItem {
  readonly id: string;
  readonly kind: PlanKind;
  readonly task?: Pick<PeerTask, "id" | "key" | "title">;
  readonly change?: string | undefined;
  /** For `create`: the new task's title. */
  readonly title?: string;
  readonly reason: string;
  /** The brief revision the item was planned against; 0 for none. */
  readonly basis: number;
}

export interface PlannedTask {
  readonly task: PeerTask;
  readonly link: PeerBriefLink;
}

const nameOf = (task: Pick<PeerTask, "id" | "key" | "title">) =>
  `${task.key === undefined ? "" : `${plain(task.key, 40)} · `}${plain(task.title, 200)} (id:${task.id})`;

export function planItems(
  tasks: ReadonlyArray<PlannedTask>,
  changes: ReadonlyArray<{ readonly name: string; readonly title: string }>,
): ReadonlyArray<PlanItem> {
  const items: Array<Omit<PlanItem, "id">> = [];
  const covered = new Set<string>();
  for (const { task, link } of tasks) {
    const basis = link.brief?.revision ?? 0;
    const linked = link.brief?.source?.change ?? link.proposed?.change;
    if (linked !== undefined) covered.add(linked.toLowerCase());
    if (link.mappingDiffers !== undefined) covered.add(link.mappingDiffers.toLowerCase());
    const one = { task, basis };
    if (link.state === "proposed" && link.proposed !== undefined)
      items.push({
        ...one,
        kind: "link",
        change: link.proposed.change,
        reason: `the repository ${link.proposed.via === "mapping" ? "maps it to" : "has a change named like it,"} ${link.proposed.change}`,
      });
    else if (link.mappingDiffers !== undefined)
      items.push({
        ...one,
        kind: "relink",
        change: link.mappingDiffers,
        reason: `openspec/peer-tasks.json now maps it to ${link.mappingDiffers}, not ${link.brief?.source?.change}`,
      });
    else if (link.state === "changed")
      items.push({
        ...one,
        kind: "refresh",
        change: link.brief?.source?.change,
        reason: `${link.brief?.source?.change} was edited after the brief was saved`,
      });
    else if (link.state === "archived" && task.status !== "done")
      items.push({
        ...one,
        kind: "close",
        change: link.brief?.source?.change,
        reason: `${link.brief?.source?.change} was archived as ${link.archivedAs}`,
      });
    else if (link.state === "missing")
      items.push({
        ...one,
        kind: "unlink",
        change: link.brief?.source?.change,
        reason: `${link.brief?.source?.change} no longer exists; the task keeps its brief as its own`,
      });
  }
  for (const change of changes)
    if (!covered.has(change.name.toLowerCase()))
      items.push({
        kind: "create",
        change: change.name,
        title: change.title,
        reason: `no task is linked to ${change.name}`,
        basis: 0,
      });
  return items.map((item, index) => ({ ...item, id: `b${index + 1}` }));
}

const EFFECT: Record<PlanKind, string> = {
  link: "link the task and save its brief from the change",
  refresh: "update the saved brief from the change",
  relink: "link the task to that change and save its brief from it",
  unlink: "keep the brief and drop its link",
  close: "mark the task done; its brief stays",
  create: "create a task with that title and link it",
};

export const planLine = (item: PlanItem) =>
  `${item.id} ${item.kind}: ${item.task === undefined ? `"${plain(item.title ?? "", 200)}"` : nameOf(item.task)}${item.change === undefined || item.kind === "create" ? "" : ` → ${item.change}`}, because ${item.reason}. Effect: ${EFFECT[item.kind]}.`;
