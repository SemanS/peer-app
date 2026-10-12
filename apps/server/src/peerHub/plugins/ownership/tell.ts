/**
 * What agents hear of ownership (design D10), each thing once: an owner's call decided or expired
 * (to the session that asked), a call or a change that concerns the owner of a path (to the owner's
 * agents), and a task changing owner (to the sessions on it). What a session was told goes in
 * `session.told("ownership")`, which core keeps across Peer's restarts and drops with a new
 * conversation; a compaction drops it here (`forgetTold`), since the model lost what it was told.
 *
 * @module peerHub/plugins/ownership/tell
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { PeerHookContext, PeerSessionView } from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { effectiveOwner, expired, pathOwner, taskRow, waiting } from "./client/rules.ts";
import type { Directory, Ownership, Standing } from "./Ownership.ts";
import {
  askedText,
  decisionText,
  expiryText,
  factText,
  ownerChangeText,
  startBlock,
} from "./text.ts";

/** What one telling says, and of which kind: the log counts the kinds and their sizes. */
export interface Line {
  readonly kind: "decision" | "expiry" | "asked" | "fact" | "owner" | "start";
  readonly text: string;
}

/** An agent of another person at work in the project, and what it changed. */
export interface Other {
  readonly id: string;
  readonly email: string;
  readonly task: string | undefined;
  readonly files: ReadonlyArray<string>;
}

/** What a telling goes by. */
export interface Hearing {
  readonly session: PeerSessionView;
  readonly standing: Standing;
  readonly directory: Directory;
  readonly told: Set<string>;
  readonly now: number;
}

/** A compaction took what the session was told out of its context. */
const forgetTold = (session: PeerSessionView) => session.told?.("ownership")?.clear();

/** Says `key` once: whether it was not said yet. */
const once = (told: Set<string>, key: string) => !told.has(key) && !!told.add(key);

/** The decisions on the session's own calls that it has not heard, oldest first. */
export const decisions = ({ session, standing, directory, told }: Hearing): ReadonlyArray<Line> =>
  mine(session, standing).flatMap((call) =>
    (call.state === "accepted" || call.state === "declined") &&
    once(told, `decision:${call.id}:${call.state}`)
      ? [{ kind: "decision" as const, text: decisionText(call, directory) }]
      : [],
  );

/** The calls this very session opened, oldest first. */
const mine = (session: PeerSessionView, { project, person, environment }: Standing) =>
  project.calls
    .filter((c) => c.email === person && c.session === session.id && c.environment === environment)
    .toReversed();

/** What the session hears without waking: expired calls, calls and changes that concern its person, its task's owner. */
export function news(hearing: Hearing, others: ReadonlyArray<Other>): ReadonlyArray<Line> {
  const { session, standing, directory: dir, told, now } = hearing;
  const { person, project } = standing;
  const lines: Line[] = [];
  const say = (kind: Line["kind"], text: string) => lines.push({ kind, text });
  for (const call of mine(session, standing))
    if (expired(call, now) && once(told, `expired:${call.id}`))
      say("expiry", expiryText(call, dir));
  for (const call of project.calls)
    if (
      call.owner === person &&
      call.email !== person &&
      waiting(call, now) &&
      once(told, `asked:${call.id}`)
    )
      say("asked", askedText(call, dir));
  if (Object.values(project.map.paths).includes(person))
    for (const other of others) {
      const paths = other.files.filter(
        (path) =>
          pathOwner(project.map, path)?.owner === person &&
          once(told, `fact:${other.task ?? other.id}:${path}`),
      );
      const label = other.task === undefined ? undefined : dir.label(other.task);
      if (paths.length > 0) say("fact", factText(dir.name(other.email), label, paths));
    }
  const task = dir.task(session.task);
  if (session.task !== undefined && task !== undefined) {
    const row = taskRow(project, session.task);
    const owner = effectiveOwner(task, row, project.map, dir.people);
    const [key, prefix] = [
      `owner:${session.task}:${owner?.owner ?? "-"}`,
      `owner:${session.task}:`,
    ];
    const before = [...told].filter((known) => known.startsWith(prefix));
    // The first look at a task's owner is not a change of it.
    if (!told.has(key)) {
      for (const known of before) told.delete(known);
      told.add(key);
      if (before.length > 0)
        say(
          "owner",
          ownerChangeText({
            label: dir.label(session.task),
            owner,
            row,
            area: task.area,
            directory: dir,
          }),
        );
    }
  }
  return lines;
}

/** How long an agent counts as at work after its last step. */
const AT_WORK_MS = 180_000;

/** The tellings as the hooks run them: from memory and the session's told set, logging kind and size only. */
export const tellings = (owned: Ownership["Service"], agents: PeerAgents.PeerAgents["Service"]) => {
  const hearing = (session: PeerSessionView) =>
    Effect.gen(function* () {
      const standing = owned.standing(session);
      const told = session.told?.("ownership");
      if (standing === undefined || told === undefined) return undefined;
      const directory = owned.directory(session.workspace, session.project);
      return { session, standing, told, directory, now: yield* Clock.currentTimeMillis };
    });
  const say = (session: PeerSessionView, lines: ReadonlyArray<Line>, between: string) =>
    Effect.gen(function* () {
      for (const { kind, text } of lines)
        yield* agents.log("ownership.told", { session: session.id, kind, chars: text.length });
      return lines.length === 0 ? null : lines.map((line) => line.text).join(between);
    });
  /** The other people's agents at work in the session's project, by what they changed. */
  const others = (heard: Hearing) =>
    agents
      .view(heard.session.workspace)
      .pipe(
        Effect.map((view) =>
          view.sessions
            .filter(
              (other) =>
                other.project === heard.session.project &&
                other.email.toLowerCase() !== heard.standing.person &&
                heard.now - Date.parse(other.activeAt ?? other.seenAt) < AT_WORK_MS,
            )
            .map(({ id, email, task, files }) => ({ id, email: email.toLowerCase(), task, files })),
        ),
      );
  /** One telling: what `lines` says of a hearing, or nothing where there is none. */
  const tell = (
    ctx: PeerHookContext,
    between: string,
    lines: (heard: Hearing) => Effect.Effect<ReadonlyArray<Line>>,
  ) =>
    Effect.gen(function* () {
      const heard = yield* hearing(ctx.session);
      return heard === undefined ? null : yield* say(ctx.session, yield* lines(heard), between);
    });
  return {
    /** A session's start block; a compaction forgets what it was told, so it comes again. */
    start: (ctx: PeerHookContext) => {
      if (ctx.source === "compact") forgetTold(ctx.session);
      return tell(ctx, "", ({ standing, directory }) => {
        const text = startBlock(standing, directory);
        return Effect.succeed(text === null ? [] : [{ kind: "start" as const, text }]);
      });
    },
    decisions: (ctx: PeerHookContext) =>
      tell(ctx, "\n\n", (heard) => Effect.succeed(decisions(heard))),
    news: (ctx: PeerHookContext) =>
      tell(ctx, "\n", (heard) => others(heard).pipe(Effect.map((seen) => news(heard, seen)))),
  };
};
