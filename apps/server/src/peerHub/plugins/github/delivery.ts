import { pullRequestRows, taskDelivery, type PeerWorkThread } from "@t3tools/contracts";

import type { PeerSessionView } from "../../core/plugin.ts";

// eslint-disable-next-line no-control-regex -- Metadata from an older Hub must not add model-input lines.
const ref = (text: string) => text.replace(/[\u0000-\u0020\u007f]/g, "").slice(0, 100);
const time = (at: string | undefined) => {
  const match = at?.match(/T(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z$/);
  return match && !Number.isNaN(Date.parse(at!)) ? `${match[1]} UTC` : "an unknown time";
};
export const START_LINE =
  "Peer: peer delivery shows this task's pull requests as GitHub confirmed them.";
export function deliveryText(
  threads: ReadonlyArray<PeerWorkThread>,
  task: string,
  name: string,
  configured: boolean,
  names: ReadonlyMap<string, string>,
) {
  const summary = taskDelivery(threads, task);
  const rows = pullRequestRows(threads, task, names);
  return [
    rows.length
      ? `${name}: ${summary.merged} of ${summary.total} linked PRs merged.`
      : `No pull request is linked to ${name} yet.`,
    ...rows.map(
      (r) =>
        `PR #${r.number} (${ref(r.headBranch)}): ${r.state} (${r.source}).${r.note === null ? "" : ` ${r.note}`}`,
    ),
    ...summary.hosts.map(
      (host) => `Delivery on ${host} is not verified; a person closes the task.`,
    ),
    ...(!configured ? ["States are as reported, not verified by GitHub."] : []),
  ].join("\n");
}
export interface DeliveryMemory {
  baseline: boolean;
  epoch: number;
  introduced?: boolean;
  told: Map<string, string>;
}
/**
 * What a session was told of its task's pull requests: that `peer delivery` exists, whether its
 * states were taken as known, and each one's state by URL. Read back from what core keeps for it
 * across Peer's restarts (`PeerSessionView.told`), so a PR merged meanwhile is still told.
 */
export const deliveryMemory = (session: PeerSessionView, epoch: number) =>
  session.local<DeliveryMemory>("github", () => {
    const memory: DeliveryMemory = { baseline: false, epoch, told: new Map() };
    for (const id of session.told?.("github") ?? []) {
      const [key = "", state] = id.split("\u0000");
      if (state !== undefined) memory.told.set(key, state);
      else if (key === "introduced") memory.introduced = true;
      else if (key === "baseline") memory.baseline = true;
    }
    return memory;
  });

/** What a session was told, as the ids core keeps for it. */
export function keepDelivery(session: PeerSessionView, memory: DeliveryMemory) {
  const kept = session.told?.("github");
  if (kept === undefined) return;
  kept.clear();
  if (memory.introduced === true) kept.add("introduced");
  if (memory.baseline) kept.add("baseline");
  for (const [url, state] of memory.told) kept.add(`${url}\u0000${state}`);
}

export function deliveryNotices(
  memory: DeliveryMemory,
  threads: ReadonlyArray<PeerWorkThread>,
  task: string,
  name: string,
  epoch: number,
): string | null {
  const rows = pullRequestRows(threads, task).filter((r) => r.verified);
  if (!memory.baseline || memory.epoch !== epoch) {
    memory.epoch = epoch;
    memory.baseline = true;
    memory.told = new Map(rows.map((r) => [r.url.toLowerCase(), r.state]));
    return null;
  }
  const summary = taskDelivery(threads, task);
  const lines: string[] = [];
  for (const r of rows) {
    const key = r.url.toLowerCase(),
      before = memory.told.get(key);
    if (before === r.state) continue;
    if (r.state === "merged")
      lines.push(
        `Peer: GitHub confirms PR #${r.number} (${ref(r.headBranch)}) merged into ${ref(r.baseBranch ?? "unknown")} at ${time(r.mergedAt)}, merge ${ref(r.mergeCommit ?? "unknown").slice(0, 7)}. ${name}: ${summary.merged} of ${summary.total} linked PRs merged.`,
      );
    else if (r.state === "closed")
      lines.push(
        `Peer: GitHub reports PR #${r.number} (${ref(r.headBranch)}) closed without merge. An agent cannot finish ${name} until it merges or a person closes the task.`,
      );
    else if (before === "closed") lines.push(`Peer: GitHub reports PR #${r.number} open again.`);
    memory.told.set(key, r.state);
    if (lines.length === 3) break;
  }
  return lines.length ? lines.join("\n") : null;
}
