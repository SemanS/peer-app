/**
 * What agents hear of ownership (design D10), each thing once: an owner's call decided or expired
 * (to the session that asked), a call or a change that concerns the owner of a path (to the owner's
 * agents), and a task changing owner (to the sessions on it). What a session was told goes in
 * `session.told("ownership")`, which core keeps across Peer's restarts and drops with a new
 * conversation; a compaction drops it here (`forgetTold`), since the model lost what it was told.
 *
 * @module peerHub/plugins/ownership/tell
 */
import type { PeerOwnerCall } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { PeerHookContext, PeerSessionView } from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { Directory, Ownership, Standing } from "./Ownership.ts";
import { effectiveOwner, pathOwner } from "./client/rules.ts";
import {
  askedText,
  decisionText,
  expiryText,
  factText,
  ownerChangeText,
  startBlock,
  waiting,
} from "./text.ts";

/** What one telling says, and of which kind: the log counts the kinds and their sizes. */
export interface Line {
  readonly kind: "decision" | "expiry" | "asked" | "fact" | "owner" | "start";
  readonly text: string;
}

/** An agent of another person that is at work in the project, and what it changed. */
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

/** A compaction took what the session was told out of its context: it is told again what matters. */
export const forgetTold = (session: PeerSessionView) => session.told?.("ownership")?.clear();

/** Says `key` once: whether it was not said yet. */
const once = (told: Set<string>, key: string) => !told.has(key) && !!told.add(key);

/** The calls this very session opened, oldest first. */
const asked = ({ session, standing }: Hearing) =>
  standing.project.calls
    .filter(
      (call) =>
        call.email === standing.person &&
        call.session === session.id &&
        call.environment === standing.environment,
    )
    .toReversed();

/** The decisions on the session's calls it has not heard: it must act on them, so they may wake it. */
export const decisions = (hearing: Hearing): ReadonlyArray<Line> =>
  asked(hearing).flatMap((call) =>
    (call.state === "accepted" || call.state === "declined") &&
    once(hearing.told, `decision:${call.id}:${call.state}`)
      ? [{ kind: "decision" as const, text: decisionText(call, hearing.directory) }]
      : [],
  );

const expired = (call: PeerOwnerCall, now: number) =>
  call.state === "expired" || (call.state === "pending" && !waiting(call, now));

/**
 * What the session hears without waking: its calls that expired, calls to its person and changes
 * in paths they own by other people's agents (told to their agents), and its task changing owner.
 */
export function news(hearing: Hearing, others: ReadonlyArray<Other>): ReadonlyArray<Line> {
  const { session, standing, directory, told, now } = hearing;
  const { person, project } = standing;
  const lines: Line[] = [];
  for (const call of asked(hearing))
    if (expired(call, now) && once(told, `expired:${call.id}`))
      lines.push({ kind: "expiry", text: expiryText(call, directory) });
  for (const call of project.calls)
    if (
      call.owner === person &&
      call.email !== person &&
      waiting(call, now) &&
      once(told, `asked:${call.id}`)
    )
      lines.push({ kind: "asked", text: askedText(call, directory) });
  if (Object.values(project.map.paths).includes(person))
    for (const other of others) {
      const paths = other.files.filter(
        (path) =>
          pathOwner(project.map, path)?.owner === person &&
          once(told, `fact:${other.task ?? other.id}:${path}`),
      );
      if (paths.length > 0)
        lines.push({
          kind: "fact",
          text: factText(
            directory.name(other.email),
            other.task === undefined ? undefined : directory.label(other.task),
            paths,
          ),
        });
    }
  const found = directory.task(session.task);
  if (session.task !== undefined && found !== undefined) {
    const row = Object.hasOwn(project.tasks, session.task)
      ? project.tasks[session.task]
      : undefined;
    const owner = effectiveOwner(found, row, project.map, directory.people);
    const key = `owner:${session.task}:${owner?.owner ?? "-"}`;
    const before = [...told].filter((known) => known.startsWith(`owner:${session.task}:`));
    // The first look at a task's owner is not a change of it.
    if (!told.has(key)) {
      for (const known of before) told.delete(known);
      told.add(key);
      if (before.length > 0)
        lines.push({
          kind: "owner",
          text: ownerChangeText({
            label: directory.label(session.task),
            owner,
            row,
            area: found.area,
            directory,
          }),
        });
    }
  }
  return lines;
}

/** How long an agent counts as at work after its last step, as coordination counts sessions. */
const AT_WORK_MS = 180_000;

/**
 * The tellings as the plugin's hooks run them: each reads from memory and the session's told set,
 * and logs how much it said of each kind, never what.
 */
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
      for (const kind of new Set(lines.map((line) => line.kind))) {
        const chars = lines
          .filter((line) => line.kind === kind)
          .reduce((n, { text }) => n + text.length, 0);
        yield* agents.log("ownership.told", { session: session.id, kind, chars });
      }
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
  return {
    /** A session's start block, once per conversation: a compaction forgets what it was told. */
    start: (ctx: PeerHookContext) =>
      Effect.gen(function* () {
        if (ctx.source === "compact") forgetTold(ctx.session);
        const heard = yield* hearing(ctx.session);
        const text = heard === undefined ? null : startBlock(heard.standing, heard.directory);
        return text === null ? null : yield* say(ctx.session, [{ kind: "start", text }], "");
      }),
    decisions: (ctx: PeerHookContext) =>
      Effect.gen(function* () {
        const heard = yield* hearing(ctx.session);
        return heard === undefined ? null : yield* say(ctx.session, decisions(heard), "\n\n");
      }),
    news: (ctx: PeerHookContext) =>
      Effect.gen(function* () {
        const heard = yield* hearing(ctx.session);
        return heard === undefined
          ? null
          : yield* say(ctx.session, news(heard, yield* others(heard)), "\n");
      }),
  };
};
