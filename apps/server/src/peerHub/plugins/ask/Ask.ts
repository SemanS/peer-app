// @effect-diagnostics nodeBuiltinImport:off - an ask's operation id.
/**
 * Ask: an agent asks the agents at work on a task its own depends on (`peer ask <task>
 * "<question>"`). Asking claims the task, so the Hub opens a conversation (an overlap) between the
 * asker and those agents, and the question goes there as a note: they hear it at their next step,
 * or wake up if idle, and answer as a note. The question goes once its conversation is settled,
 * after a minute when none opened, or after two hours; while ask is off, an open conversation goes
 * on as any overlap does.
 *
 * @module peerHub/plugins/ask/Ask
 */
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { scopeOf } from "../../core/contexts/text.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { claimedTask, taskClaim } from "../../core/coordination/edits.ts";
import * as PeerIndex from "../../core/index/PeerIndex.ts";
import { PeerCommandError, type PeerSessionView } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";

/** What agents type. */
const CLI = "peer";
/** A question about a task goes once settled, after this long when no conversation opened, or after `ASK_MAX_MS`. */
const ASK_SETTLE_MS = 60_000;
const ASK_MAX_MS = 2 * 60 * 60 * 1000;
/** How many works a question naming no task lists: as many as `peer status` does. */
const KNOWN_SHOWN = 30;

/** Names one command to the hub, so that repeating it (a retry) has no further effect. */
const newOp = () => NodeCrypto.randomBytes(12).toString("hex");

export class Ask extends Context.Service<
  Ask,
  {
    /** An agent's question to the agents at work on another task, as `peer ask` answers it. */
    readonly ask: (
      session: PeerSessionView,
      handle: string,
      question: string,
    ) => Effect.Effect<string, PeerCommandError>;
    /** Drops the questions whose conversations settled as views change, until interrupted. */
    readonly follow: Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/ask/Ask") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const agents = yield* PeerAgents.PeerAgents;
  const index = yield* PeerIndex.PeerIndex;
  /** Session → its workspace and the tasks it asked the agents of (`task:<id>` claims), and when. */
  const open = new Map<
    string,
    { readonly workspace: string; readonly asks: Map<string, number> }
  >();

  const asksOf = (session: PeerSessionView) => {
    const known = open.get(session.id);
    if (known !== undefined) return known.asks;
    const asks = new Map<string, number>();
    open.set(session.id, { workspace: session.workspace, asks });
    return asks;
  };

  const ask: Ask["Service"]["ask"] = (session, handle, question) =>
    Effect.gen(function* () {
      const { workspace, project } = session;
      const scope = yield* index.scope(workspace, project, handle);
      if (scope === undefined) {
        const known = (yield* index.works(session))
          .slice(0, KNOWN_SHOWN)
          .map((entry) => entry.handle);
        return `peer: no task "${handle}" on ${project}.${known.length === 0 ? "" : ` Work on it now: ${known.join(", ")}.`}`;
      }
      const name = yield* index.subject(workspace, project, scope);
      if (scope === scopeOf(session.task)) {
        return `peer: ${name} is your own work. Its agents read its shared context${session.keeps ? ", which you keep" : ""}; ${CLI} note reaches the agents you share files with.`;
      }
      const task = claimedTask(scope);
      if (task === undefined) {
        return `peer: ask the agents on a task. Agents outside tasks hear you through the files you both change (${CLI} claim <path>).`;
      }
      yield* agents.sync(workspace, 3000);
      const pointer = yield* index.pointer(workspace, project, scope);
      const there = (yield* agents.view(workspace)).sessions.filter(
        (other) => other.project === project && other.task === task && other.id !== session.id,
      );
      if (there.length === 0) {
        return `Nobody's agent works on ${name} now, so nobody can answer.${pointer === null ? "" : ` ${pointer}`} If you need its people, tell yours.`;
      }
      const claim = taskClaim(task);
      yield* agents.claim(session.id, claim);
      asksOf(session).set(claim, yield* Clock.currentTimeMillis);
      yield* agents.sync(workspace, 3000);
      const overlaps = (yield* agents.view(workspace)).overlaps.filter(
        (overlap) =>
          overlap.project === project &&
          overlap.sessions.includes(session.id) &&
          overlap.files.includes(claim),
      );
      if (overlaps.length === 0) {
        yield* agents.release(session.id, claim);
        asksOf(session).delete(claim);
        yield* agents.log("ask.unopened", { session: session.id, task });
        return `peer: the hub opened no conversation with the agents on ${name}; it may be older than peer ask.${pointer === null ? "" : ` ${pointer}`}`;
      }
      const op = newOp();
      for (const overlap of overlaps) {
        yield* agents.note({ session: session.id, overlap: overlap.id, text: question, op }).pipe(
          Effect.mapError(
            () =>
              new PeerCommandError({
                status: 500,
                message: "peer: the request failed; check Peer's coordination status and retry.",
              }),
          ),
        );
      }
      const asked = (yield* index.works(session)).find((work) => work.scope === scope);
      yield* agents.advise(session.id, {
        about: "work",
        scope,
        name: asked?.name ?? scope,
        how: "asked",
        why: "asked the agents at work on it",
      });
      yield* agents.log("ask", {
        session: session.id,
        task,
        overlaps: overlaps.map((overlap) => overlap.id),
        text: question,
        op,
      });
      const who = there
        .map(
          (other) =>
            `${state.nameOf(workspace, other.email)}'s agent${other.environment === state.environmentId ? "" : " (on another computer)"}`,
        )
        .join(", ");
      return `Asked the agents on ${name}: ${who}. They hear it at their next step, or wake up if idle, and their answer reaches you as Peer news (${CLI} status shows the conversation). Once settled: ${CLI} resolve "<agreement>".${pointer === null ? "" : ` Meanwhile: ${pointer}`}`;
    });

  /** Questions about a task go when their conversation is settled, or after a while without one. */
  const dropSettled = (workspace: string) =>
    Effect.gen(function* () {
      const { overlaps } = yield* agents.view(workspace);
      const live = new Set((yield* agents.sessions).map((session) => session.id));
      const now = yield* Clock.currentTimeMillis;
      for (const [session, { workspace: where, asks }] of open) {
        // A session that ended took its claims with it.
        if (!live.has(session)) {
          open.delete(session);
          continue;
        }
        if (where !== workspace) continue;
        for (const [claim, at] of asks) {
          const about = overlaps.filter(
            (overlap) => overlap.sessions.includes(session) && overlap.files.includes(claim),
          );
          const settled =
            about.length > 0 && about.every((overlap) => overlap.state === "resolved");
          const unanswered = about.length === 0 && now - at > ASK_SETTLE_MS;
          if (!settled && !unanswered && now - at < ASK_MAX_MS) continue;
          asks.delete(claim);
          yield* agents.release(session, claim);
          yield* agents.log("ask.dropped", { session, claim, settled, ms: now - at });
        }
      }
    });

  return Ask.of({
    ask,
    follow: agents.viewChanges.pipe(Stream.runForEach(dropSettled)),
  });
});

export const layer = Layer.effect(Ask, make);
