/**
 * Flows: a knowledge entry that reads the store as a process. An `architecture` entry whose id
 * starts with `flow-` (or that is tagged `flow`) carries a `## Trail`, a numbered list of
 * `[[entry-id]] — one sentence` steps in the order a reader meets the entries, with `###` headings
 * for stages. Peer reads the trail from the entry's full text, before the presentation cap, so a
 * long trail keeps every step; the page draws it as a rail with each step's health.
 *
 * @module peerHub/plugins/knowledge/client/flows
 */
import type { PeerFlowStep } from "@t3tools/contracts";

import { plain } from "../../../peerText.ts";

/** Whether an entry is a flow, by its shape: no new kind, so older readers see an architecture note. */
export const isFlow = (entry: {
  readonly id: string;
  readonly kind: string;
  readonly tags?: ReadonlyArray<string> | undefined;
}): boolean =>
  entry.kind === "architecture" &&
  (entry.id.startsWith("flow-") || (entry.tags ?? []).includes("flow"));

/** Steps a trail may carry; a longer one is a list, not a trail. */
const STEPS_MAX = 200;
const HEADING = /^(#{2,6})\s+(.+?)\s*#*\s*$/;
/** `N. [[id]] — text`, with the id shaped as kontext allows (`[[id|label]]` keeps the id). */
const STEP =
  /^\s*\d+[.)]\s+\[\[([\p{L}\p{N}_.:-]{1,160})(?:[|#][^\]]*)?\]\]\s*(?:[—–-]+\s*)?(.*)$/u;

/** The trail's steps in order, each with the stage heading it stands under; none without a trail. */
export function trail(body: string): PeerFlowStep[] {
  const steps: PeerFlowStep[] = [];
  let inTrail = false;
  let stage: string | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      if (level === 2) {
        inTrail = /^trail$/i.test(text);
        stage = null;
      } else if (inTrail) stage = plain(text, 80) || null;
      continue;
    }
    if (!inTrail) continue;
    const step = STEP.exec(line);
    if (step === null) continue;
    steps.push({ stage, entry: step[1]!.trim(), text: plain(step[2] ?? "", 300) });
    if (steps.length >= STEPS_MAX) break;
  }
  return steps;
}
