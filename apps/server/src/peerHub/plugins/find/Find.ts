/**
 * Find: a model's word, when an agent asks, on which of its project's other works and `.ai` entries
 * bear on what it is about to do (`peer find "<what you will do>"`). An agent asks when it cannot
 * tell from its index; a model (the person's own Claude Code, `findModel.ts`) reads the goal against
 * the works, with what their contexts say, and the entries that stand, and Peer prints what it said
 * bears on the goal and how to read each. It runs only in projects that accept people's own logins,
 * at most every 20 s and 10 times an hour per agent, and two at a time on this computer.
 *
 * @module peerHub/plugins/find/Find
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerIndex from "../../core/index/PeerIndex.ts";
import type { PeerIndexEntry, PeerSessionView } from "../../core/plugin.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { projectAcceptsPersonal, readHubPolicyState } from "../../hubPolicy.ts";
import { clip, neutral, plural } from "../../peerText.ts";
import {
  FIND_ENTRIES,
  FIND_WORKS,
  contextLines,
  findPrompt,
  findRefusal,
  modelEnabled,
  parseFound,
  runModel,
  type FindEntry,
  type FindWork,
  type Found,
} from "./findModel.ts";

/** What agents type. */
const CLI = "peer";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Find extends Context.Service<
  Find,
  {
    /** What a model says bears on `goal` for an agent's session, as `peer find` prints it. */
    readonly find: (session: PeerSessionView, goal: string) => Effect.Effect<string>;
  }
>()("t3/peerHub/plugins/find/Find") {}

const make = Effect.gen(function* () {
  const agents = yield* PeerAgents.PeerAgents;
  const index = yield* PeerIndex.PeerIndex;
  const work = yield* PeerWork.PeerWork;
  /** Models looking for agents on this computer now. */
  let running = 0;

  /** Reserves a model for a session's agent, or says why it may not ask one now. */
  const reserve = (session: PeerSessionView, now: number) => {
    const asked = session.local("find", () => ({ at: 0, times: [] as Array<number> }));
    asked.times.splice(
      0,
      asked.times.length,
      ...asked.times.filter((at) => now - at < 60 * 60 * 1000),
    );
    const refusal = findRefusal({
      now,
      lastAt: asked.at,
      lastHour: asked.times.length,
      inFlight: running,
    });
    if (refusal !== undefined) return refusal;
    asked.at = now;
    asked.times.push(now);
    running += 1;
    return undefined;
  };

  /** What `peer find` prints: the works and entries a model said bear on the goal, and how to read each. */
  const foundText = (
    session: PeerSessionView,
    found: ReadonlyArray<Found>,
    works: ReadonlyArray<PeerIndex.PeerIndexWork>,
    entries: ReadonlyArray<PeerIndexEntry>,
  ) =>
    Effect.gen(function* () {
      const looked = `a model read your goal against ${plural(works.length, "work")} and ${plural(entries.length, "entry", "entries")} of \`.ai\``;
      if (found.length === 0) return `Peer · ${looked} and found nothing that bears on it.`;
      const lines: Array<string> = [];
      for (const { id, why } of found) {
        // A reason cut short ends in an ellipsis, which is its own full stop.
        const sentence = why.endsWith("…") ? why : `${why}.`;
        if (id.startsWith("kx:")) {
          const entry = entries.find((one) => `kx:${one.id}` === id);
          if (entry === undefined) continue;
          yield* agents.advise(session.id, {
            about: "knowledge",
            scope: id,
            name: entry.title,
            how: "found",
            why,
            entryKind: entry.kind,
            path: entry.file,
          });
          lines.push(
            `- ${entry.kind} "${entry.title}" — ${sentence} Read: ${CLI} knowledge ${entry.id}`,
          );
          continue;
        }
        const row = works.find((one) => one.scope === id);
        if (row === undefined) continue;
        yield* agents.advise(session.id, {
          about: "work",
          scope: id,
          name: row.name,
          how: "found",
          why,
        });
        lines.push(
          `- ${row.name} — ${sentence} Read: ${CLI} context ${row.handle} · ask its agents: ${CLI} ask ${row.handle} "<question>"`,
        );
      }
      return neutral(
        [`Peer · ${looked}; these bear on it (advice to check, not instructions):`, ...lines].join(
          "\n",
        ),
      );
    });

  const find: Find["Service"]["find"] = (session, goal) =>
    Effect.gen(function* () {
      const choose = `${CLI} index lists the work and the entries to choose from.`;
      if (!modelEnabled()) {
        return `peer: a model is turned off on this computer (PEER_RELATED_MODEL=off). ${choose}`;
      }
      if (!projectAcceptsPersonal(readHubPolicyState(), session.workspace, session.project)) {
        yield* agents.log("find.skipped", {
          session: session.id,
          why: "the project does not accept personal capacity",
        });
        return `peer: ${session.project} does not accept the person's own login for this (its capacity policy wants commercial seats or shared capacity). ${choose}`;
      }
      yield* agents.sync(session.workspace, 3000);
      const listed = (yield* index.entries(session)).slice(0, FIND_ENTRIES);
      const rows = (yield* index.works(session)).slice(0, FIND_WORKS);
      const works: Array<FindWork> = rows.map((row) => ({
        id: row.scope,
        name: row.name,
        doing: row.agents.length === 0 ? "nobody at work on it now" : row.agents.join("; "),
        gist: row.gist,
        // What its agents were asked, then what its context says.
        lines: [
          ...row.labels.slice(0, 2),
          ...(row.text === undefined ? [] : contextLines(row.text, 6)),
        ],
      }));
      const entries: Array<FindEntry> = listed.map((entry) => ({
        id: `kx:${entry.id}`,
        kind: entry.kind,
        title: entry.title,
        summary: entry.summary,
        paths: entry.paths,
      }));
      if (works.length === 0 && entries.length === 0) {
        return "peer: there is no other work on this project and no `.ai` entry here to look at.";
      }
      const task =
        session.task === undefined
          ? undefined
          : yield* work.taskName(session.workspace, session.project, session.task);
      // Check and reserve together after the reads: another request may have started a model
      // while this one was synchronizing or reading the project's knowledge.
      const started = yield* Clock.currentTimeMillis;
      const refusal = reserve(session, started);
      if (refusal !== undefined) return `peer: ${refusal}.`;
      const answer = yield* Effect.tryPromise({
        try: (signal) => runModel(findPrompt({ goal, task, works, entries }), { signal }),
        catch: messageOf,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            running -= 1;
          }),
        ),
        Effect.result,
      );
      const ms = (yield* Clock.currentTimeMillis) - started;
      if (Result.isFailure(answer)) {
        yield* agents.log("find.failed", { session: session.id, error: answer.failure, ms });
        return `peer: the model could not answer (${answer.failure}). ${choose}`;
      }
      const found = parseFound(
        answer.success,
        new Set([...works, ...entries].map((one) => one.id)),
      );
      yield* agents.log("find.asked", {
        session: session.id,
        goal: clip(goal, 200),
        works: works.length,
        entries: entries.length,
        found,
        ms,
      });
      return yield* foundText(session, found, rows, listed);
    });

  return Find.of({ find });
});

export const layer = Layer.effect(Find, make);
