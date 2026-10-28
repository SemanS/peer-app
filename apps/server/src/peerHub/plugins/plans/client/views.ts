import type { PeerPlansPlace, PeerPlansStatus, PeerPlansView } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
/** A Hub that has no route for plans is not asked again for this long. */
const PAUSE_MS = 600_000;

/** What people see of a view: `at` moves with every read, the rest only when plans do. */
const same = (a: PeerPlansView, b: PeerPlansView) =>
  encodeJson([a.plans, a.relations, a.omitted, a.challenges ?? null]) ===
  encodeJson([b.plans, b.relations, b.omitted, b.challenges ?? null]);

/**
 * What the plugin keeps of the Hub's plans: each workspace's view as last read, what the Hub said
 * of having plans at all, and a revision that moves when clients should read again.
 */
export function createViews(forcedOff: () => boolean) {
  const views = new Map<string, PeerPlansView>();
  let revision = 0;
  let support: PeerPlansStatus["hubSupport"] = "unknown";
  let contact: string | undefined;
  let pausedUntil = 0;
  return {
    get: (workspace: string) => views.get(workspace),
    /** Moves whenever people would see a difference. */
    revision: () => revision,
    /** Keeps what the Hub answered to a read; null is a Hub without plans. */
    keep(workspace: string, view: PeerPlansView | null, now: number) {
      if (view === null) {
        support = "unsupported";
        pausedUntil = now + PAUSE_MS;
        if (views.delete(workspace)) revision += 1;
        return;
      }
      support = "supported";
      contact = DateTime.formatIso(DateTime.makeUnsafe(now));
      const before = views.get(workspace);
      if (before === undefined || !same(before, view)) {
        views.set(workspace, view);
        revision += 1;
      }
    },
    /** The Hub answered a declaration as one without plans. */
    unsupported(now: number) {
      support = "unsupported";
      pausedUntil = now + PAUSE_MS;
    },
    /** Whether the Hub is worth asking: not while it said, lately, that it has no plans. */
    askable: (now: number) => now >= pausedUntil,
    /** Forgets a workspace's view, or every one, so that clients read again. */
    drop(workspace?: string) {
      revision += 1;
      for (const slug of views.keys())
        if (workspace === undefined || slug === workspace) views.delete(slug);
      if (workspace === undefined) {
        support = "unknown";
        contact = undefined;
        pausedUntil = 0;
      }
    },
    /** The status field: the live plans and relations that name each task, and the revision. */
    status(): PeerPlansStatus {
      type Row = PeerPlansStatus["counts"][number];
      const rows = new Map<string, { -readonly [K in keyof Row]: Row[K] }>();
      const row = (workspace: string, project: string, task: string) => {
        const key = `${workspace}/${project}/${task}`;
        const known = rows.get(key) ?? { workspace, project, task, plans: 0, relations: 0 };
        rows.set(key, known);
        return known;
      };
      for (const [workspace, view] of views) {
        for (const plan of view.plans)
          if (plan.live && plan.task !== undefined)
            row(workspace, plan.project, plan.task).plans += 1;
        for (const relation of view.relations)
          for (const side of [relation.a, relation.b])
            if (side.task !== undefined) row(workspace, relation.project, side.task).relations += 1;
        // A task counts each open challenge once: one that meets its plans or that its agents made.
        // A Hub older than plans revision 2 sends none, and the field stays absent.
        for (const challenge of view.challenges ?? []) {
          if (challenge.state !== "open") continue;
          const tasks = [challenge.by.task, ...challenge.meets.map((met) => met.side.task)];
          for (const task of new Set(tasks)) {
            if (task === undefined) continue;
            const counted = row(workspace, challenge.project, task);
            counted.challenges = (counted.challenges ?? 0) + 1;
          }
        }
        if (view.challenges !== undefined)
          for (const counted of rows.values())
            if (counted.workspace === workspace) counted.challenges ??= 0;
      }
      return {
        enabled: true,
        forcedOff: forcedOff(),
        hubSupport: support,
        ...(contact === undefined ? {} : { lastContact: contact }),
        counts: [...rows.values()],
        revision,
      };
    },
  };
}

/** A view narrowed to a project, or to one task: its plans and the relations that name it. */
export function inPlace(view: PeerPlansView, place: PeerPlansPlace): PeerPlansView {
  const project = (name: string) => !place.project || name === place.project;
  return {
    ...view,
    plans: view.plans.filter(
      (plan) => project(plan.project) && (!place.task || plan.task === place.task),
    ),
    relations: view.relations.filter(
      (relation) =>
        project(relation.project) &&
        (!place.task || relation.a.task === place.task || relation.b.task === place.task),
    ),
    ...(view.challenges === undefined
      ? {}
      : {
          challenges: view.challenges.filter(
            (challenge) =>
              project(challenge.project) &&
              (!place.task ||
                challenge.by.task === place.task ||
                challenge.meets.some((met) => met.side.task === place.task)),
          ),
        }),
  };
}
