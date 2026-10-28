import type { PeerFlowStep } from "@t3tools/contracts";

import type { EntryHealth } from "./knowledge.logic";

/** A flow by its shape: an architecture entry with id `flow-…` or tagged `flow`. */
export function isFlowEntry(entry: {
  readonly id: string;
  readonly kind: string;
  readonly tags?: ReadonlyArray<string> | undefined;
}): boolean {
  return (
    entry.kind === "architecture" &&
    (entry.id.startsWith("flow-") || (entry.tags ?? []).includes("flow"))
  );
}

/** `Flow: a read, from the request to the cache` → `A read, from the request to the cache`. */
export function flowTitle(title: string): string {
  const bare = title.replace(/^flow:\s*/i, "").trim();
  return bare === "" ? title : bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** The text before the trail, as the flow's own words on where it starts and ends. */
export function flowIntro(body: string): string {
  const at = body.search(/^##\s+trail\s*$/im);
  return (at < 0 ? body : body.slice(0, at)).replace(/\s+/g, " ").trim();
}

export interface TrailStage {
  readonly stage: string | null;
  /** Each step with its number along the whole trail, counted from one. */
  readonly steps: ReadonlyArray<PeerFlowStep & { readonly n: number }>;
}

/** The trail's consecutive stages, each with its steps numbered along the whole trail. */
export function trailStages(trail: ReadonlyArray<PeerFlowStep>): TrailStage[] {
  const stages: { stage: string | null; steps: (PeerFlowStep & { n: number })[] }[] = [];
  trail.forEach((step, index) => {
    const last = stages.at(-1);
    const numbered = { ...step, n: index + 1 };
    if (last !== undefined && last.stage === step.stage) last.steps.push(numbered);
    else stages.push({ stage: step.stage, steps: [numbered] });
  });
  return stages;
}

export interface TrailHealth {
  readonly steps: number;
  /** Steps whose entry is in the saved knowledge; the rest were superseded, retired or never there. */
  readonly known: number;
  readonly verified: number;
  readonly review: number;
}

/** How far a trail can be trusted: counted over the steps whose entry the page knows. */
export function trailHealth(
  trail: ReadonlyArray<PeerFlowStep>,
  healthOf: (entry: string) => EntryHealth | null,
): TrailHealth {
  let known = 0;
  let verified = 0;
  let review = 0;
  for (const step of trail) {
    const health = healthOf(step.entry);
    if (health === null) continue;
    known += 1;
    if (health === "verified") verified += 1;
    if (health === "needs-review") review += 1;
  }
  return { steps: trail.length, known, verified, review };
}

/** `21 steps · 12 verified · 2 need review`, or what is known of it. */
export function trailHealthLine(health: TrailHealth): string {
  const parts = [health.steps === 1 ? "1 step" : `${health.steps} steps`];
  if (health.known > 0) parts.push(`${health.verified} verified`);
  if (health.review > 0)
    parts.push(`${health.review} need${health.review === 1 ? "s" : ""} review`);
  if (health.known < health.steps)
    parts.push(`${health.steps - health.known} not in the saved knowledge`);
  return parts.join(" · ");
}
