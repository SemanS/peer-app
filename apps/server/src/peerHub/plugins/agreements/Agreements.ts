/**
 * Agreements: what this computer knows of the agreements of the workspaces its person is in, as the
 * Hub last said (`hub.ts`), read when the Hub pings `agreements` (and `work`, which is how a task
 * landing reaches it) and after a resync. Notices, the status and `peer agreements` read it from
 * memory or from the Hub as each says; nothing a hook does waits on the Hub, so a Hub that cannot be
 * reached leaves them the last snapshot. The apps' actions go to the Hub. The interface is what
 * `make` returns, each member described there.
 *
 * @module peerHub/plugins/agreements/Agreements
 */
import {
  PeerHubError,
  type PeerAgreement,
  type PeerAgreementCloseInput,
  type PeerAgreementReopenInput,
  type PeerAgreementResult,
  type PeerAgreementsPlace,
  type PeerAgreementsStatus,
  type PeerAgreementsView,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import {
  refused,
  type CliError,
  type PeerHookContext,
  type PeerSessionView,
  type PeerToolContext,
} from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { plain } from "../../peerText.ts";
import { agreementsHub } from "./hub.ts";
import {
  liveKey,
  newestFirst,
  notClosed,
  ofTask,
  sliceOf,
  tellable,
  toldKey,
  tookPart,
  transitions,
  untold,
  type Viewer,
} from "./rules.ts";
import {
  blockOf,
  listText,
  noneText,
  noticeText,
  NO_TASK,
  publicText,
  type Voice,
} from "./text.ts";

/** `PEER_AGREEMENTS=off` keeps agreements off on this computer, whatever its owner chose in Settings. */
export const forcedOff = () => process.env.PEER_AGREEMENTS === "off";

const OLDER = "Agreements need a newer Peer Hub.";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export class Agreements extends Context.Service<
  Agreements,
  {
    /** The status field: per workspace, counts and ids of what was last read. */
    readonly status: Effect.Effect<PeerAgreementsStatus>;
    /** The agreements of a workspace or of one of its projects, read from the Hub now and kept. */
    readonly view: (place: PeerAgreementsPlace) => Effect.Effect<PeerAgreementsView, PeerHubError>;
    /** A person closes an agreement as handled or not needed; the snapshot is read again. */
    readonly close: (
      input: PeerAgreementCloseInput,
    ) => Effect.Effect<PeerAgreementResult, PeerHubError>;
    /** A person brings back an agreement a person closed; the snapshot is read again. */
    readonly reopen: (
      input: PeerAgreementReopenInput,
    ) => Effect.Effect<PeerAgreementResult, PeerHubError>;
    /**
     * The Hub said something changed in a workspace: it is read within a moment, a burst once. A task
     * landing (`work`) matters only while an agreement waits for one to.
     */
    readonly readSoon: (workspace: string, change?: string) => Effect.Effect<void>;
    /**
     * What a session hears at a step, and at a landing step: the agreements of its task that it has
     * not heard and did not take part in, from the snapshot, within 1,200 characters. It marks what
     * it gives as told, so the stop and the next step never both say it.
     */
    readonly notice: (ctx: PeerHookContext | PeerToolContext) => Effect.Effect<string | null>;
    /** A session starts: after a compaction it hears its agreements once more. */
    readonly started: (ctx: PeerHookContext) => Effect.Effect<null>;
    /**
     * What `peer agreements` prints, read from the Hub now: a session's task's agreements, which the
     * session counts as heard, or, in a person's terminal (a public session), the project's open
     * ones and nothing recorded.
     */
    readonly show: (session: PeerSessionView) => Effect.Effect<string, PeerHubError | CliError>;
    /** Forgets one workspace, or every one: signing out, leaving, turning the plugin off. */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** Forgets every workspace but these, which the person still belongs to. */
    readonly keep: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    /** Reads every workspace now, then as the Hub pings, until interrupted. */
    readonly run: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/agreements/Agreements") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const published = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const work = yield* PeerWork.PeerWork;
  const hub = agreementsHub(yield* PeerHubClient.PeerHubClient);
  /** Each workspace's agreements as the Hub last said. */
  const views = new Map<string, PeerAgreementsView>();
  const changed = yield* Queue.unbounded<string>();
  /** The agreements already counted as fallen due (`workspace/project/id`), so each is counted once. */
  const counted = new Set<string>();
  /** The read of a workspace started last and the one applied last: an answer that comes late is dropped. */
  const asked = new Map<string, number>();
  const applied = new Map<string, number>();
  let support: PeerAgreementsStatus["hubSupport"] = "unknown";
  let contact: string | undefined;

  const viewerOf = (): Viewer | undefined => {
    const person = state.current().persisted.email?.toLowerCase();
    return person === undefined ? undefined : { person, environment: state.environmentId };
  };

  /**
   * Keeps what the Hub answered to a read of a workspace, or of one project of it (which replaces
   * that project's agreements alone); null is a Hub without the feature. Logs the changes the log
   * counts. Says whether people would see a difference.
   */
  const put = (workspace: string, answer: PeerAgreementsView | null, project?: string) =>
    Effect.gen(function* () {
      const was = support;
      if (answer === null) {
        support = "unsupported";
        return views.delete(workspace) || was !== support;
      }
      support = "supported";
      contact = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      const before = views.get(workspace);
      // One project's agreements have no workspace to be put among until one was read.
      if (project !== undefined && before === undefined) return was !== support;
      const next: PeerAgreementsView =
        project === undefined || before === undefined
          ? answer
          : {
              at: answer.at,
              agreements: [
                ...before.agreements.filter((agreement) => agreement.project !== project),
                ...answer.agreements,
              ],
            };
      views.set(workspace, next);
      const seen = transitions(before?.agreements, next.agreements);
      for (const key of seen.due) {
        if (counted.has(`${workspace}/${key}`)) continue;
        counted.add(`${workspace}/${key}`);
        yield* agents.log("agreements.due", {});
      }
      for (const why of seen.closed) yield* agents.log("agreements.closed", { why });
      return (
        was !== support ||
        before === undefined ||
        encodeJson(before.agreements) !== encodeJson(next.agreements)
      );
    });

  /** Reads a workspace's agreements, or one project's, from the Hub now and keeps them; null: no such feature. */
  const load = (workspace: string, project?: string) =>
    Effect.gen(function* () {
      const order = (asked.get(workspace) ?? 0) + 1;
      asked.set(workspace, order);
      const answer = yield* hub.view(workspace, project);
      if (order >= (applied.get(workspace) ?? 0)) {
        applied.set(workspace, order);
        if (yield* put(workspace, answer, project)) yield* published.publish;
      }
      return answer;
    });
  /** The same, for the background: a Hub that cannot be reached leaves the snapshot as it was. */
  const read = (workspace: string) => load(workspace).pipe(Effect.ignore);

  /** Forgets one workspace, or every one: its snapshot, its counts, and any read of it still on its way. */
  const drop = (workspace?: string) => {
    for (const slug of new Set([...views.keys(), ...asked.keys()])) {
      if (workspace !== undefined && slug !== workspace) continue;
      const fence = (asked.get(slug) ?? 0) + 1;
      asked.set(slug, fence);
      applied.set(slug, fence);
      views.delete(slug);
      for (const id of counted) if (id.startsWith(`${slug}/`)) counted.delete(id);
    }
    if (workspace === undefined) {
      support = "unknown";
      contact = undefined;
    }
  };

  /** The person must be in the workspace, and on the project when one is named, before the Hub hears of it. */
  const known = (workspace: string, project?: string) =>
    project === undefined
      ? Effect.gen(function* () {
          if (!(yield* state.workspaces).some((candidate) => candidate.slug === workspace))
            return yield* new PeerHubError({
              detail: "That workspace is not available here.",
              refused: true,
            });
        })
      : state.project(workspace, project);

  /** A person's change of an agreement: the Hub is asked, then the snapshot is read again. */
  const act = (
    workspace: string,
    project: string,
    call: Effect.Effect<PeerAgreementResult | null, PeerHubError>,
  ) =>
    Effect.gen(function* () {
      yield* state.project(workspace, project);
      const result = yield* call;
      if (result === null) return yield* new PeerHubError({ detail: OLDER, refused: true });
      yield* read(workspace);
      return result;
    });

  /** How tasks and people are named to agents in a project, and the time agents read it at. */
  const voiceOf = (workspace: string, project: string) =>
    Effect.gen(function* () {
      const tasks = yield* work.tasks(workspace, project);
      return {
        now: yield* Clock.currentTimeMillis,
        task: (id) => {
          const found = tasks.find((candidate) => candidate.id === id);
          return plain(found?.key ?? found?.title ?? id, 40);
        },
        person: (email) => plain(state.nameOf(workspace, email), 60),
      } satisfies Voice;
    });

  /** The agreements of the session's task it has not heard, from the snapshot as it is now. */
  const untoldFor = (session: PeerSessionView): ReadonlyArray<PeerAgreement> => {
    const { task } = session;
    const view = views.get(session.workspace);
    const told = session.told?.("agreements");
    const viewer = viewerOf();
    return task === undefined || view === undefined || told === undefined || viewer === undefined
      ? []
      : untold(view, { id: session.id, project: session.project, task }, viewer, told);
  };

  return Agreements.of({
    status: Effect.gen(function* () {
      const viewer = viewerOf();
      const workspaces = yield* Effect.forEach(
        [...views].toSorted(([a], [b]) => a.localeCompare(b)),
        ([workspace, view]) =>
          agents
            .view(workspace)
            .pipe(
              Effect.map(({ sessions }) =>
                sliceOf(
                  workspace,
                  view,
                  viewer,
                  new Set(
                    sessions.flatMap((session) =>
                      session.task === undefined ? [] : [liveKey(session.project, session.task)],
                    ),
                  ),
                ),
              ),
            ),
      );
      return {
        enabled: true,
        forcedOff: forcedOff(),
        hubSupport: support,
        ...(contact === undefined ? {} : { lastContact: contact }),
        workspaces,
      } satisfies PeerAgreementsStatus;
    }),
    view: Effect.fn("Agreements.view")(function* (place: PeerAgreementsPlace) {
      yield* known(place.workspace, place.project);
      return (
        (yield* load(place.workspace, place.project)) ??
        (yield* new PeerHubError({ detail: OLDER, refused: true }))
      );
    }),
    close: (input) =>
      act(
        input.workspace,
        input.project,
        hub.close(input.workspace, input.project, input.id, input.why),
      ),
    reopen: (input) =>
      act(input.workspace, input.project, hub.reopen(input.workspace, input.project, input.id)),
    notice: ({ session }) =>
      Effect.gen(function* () {
        if (untoldFor(session).length === 0) return null;
        const voice = yield* voiceOf(session.workspace, session.project);
        // Another step of the session may have heard some while the tasks were read.
        const fresh = untoldFor(session);
        if (fresh.length === 0) return null;
        const blocks = fresh.map((agreement) => blockOf(agreement, voice, session.task));
        const { text, shown } = noticeText(blocks);
        const given = fresh.slice(0, shown);
        for (const agreement of given) session.told?.("agreements").add(toldKey(agreement));
        for (const block of blocks.slice(0, shown))
          yield* agents.log("agreements.told", { session: session.id, chars: block.length });
        return text;
      }),
    started: ({ session, source }) =>
      Effect.sync(() => {
        // The model lost what it was told when its context was compacted.
        if (source === "compact") session.told?.("agreements").clear();
        return null;
      }),
    show: Effect.fn("Agreements.show")(function* (session: PeerSessionView) {
      const view = yield* hub.view(session.workspace, session.project, 8_000);
      if (view === null)
        return yield* Effect.fail(
          refused(
            "this Peer Hub cannot list agreements",
            "ask your person to update the Peer Hub.",
          ),
        );
      const voice = yield* voiceOf(session.workspace, session.project);
      if (session.public === true)
        return publicText(
          session.project,
          view.agreements
            .filter(notClosed)
            .toSorted(newestFirst)
            .map((agreement) => blockOf(agreement, voice)),
        );
      const { task } = session;
      if (task === undefined) return NO_TASK;
      const mine = ofTask(view, session.project, task, voice.now);
      if (mine.length === 0) return noneText(voice.task(task));
      const blocks = mine.map((agreement) => blockOf(agreement, voice, task));
      const { text, shown } = listText(voice.task(task), mine, blocks);
      // What the agent reads here it has heard: no step says it again.
      const told = session.told?.("agreements");
      const viewer = viewerOf();
      const heard =
        told === undefined || viewer === undefined
          ? []
          : mine
              .slice(0, shown)
              .flatMap((agreement, at) =>
                tellable(agreement) &&
                !told.has(toldKey(agreement)) &&
                !tookPart(agreement, session, viewer)
                  ? [{ agreement, chars: blocks[at]?.length ?? 0 }]
                  : [],
              );
      for (const { agreement } of heard) told?.add(toldKey(agreement));
      for (const { chars } of heard)
        yield* agents.log("agreements.told", { session: session.id, chars });
      return text;
    }),
    readSoon: (workspace, change) =>
      change === "work" && !(views.get(workspace)?.agreements.some(notClosed) ?? false)
        ? Effect.void
        : Queue.offer(changed, workspace).pipe(Effect.asVoid),
    forget: (workspace) =>
      Effect.sync(() => drop(workspace)).pipe(Effect.andThen(Queue.clear(changed)), Effect.asVoid),
    keep: (workspaces) =>
      Effect.sync(() => {
        for (const slug of views.keys()) if (!workspaces.includes(slug)) drop(slug);
      }),
    run: Effect.gen(function* () {
      for (const { slug } of yield* state.workspaces) yield* read(slug);
      while (true) {
        const first = yield* Queue.take(changed);
        // A burst of pings reads each workspace once.
        yield* Effect.sleep("300 millis");
        for (const workspace of new Set([first, ...(yield* Queue.clear(changed))]))
          yield* read(workspace);
      }
    }),
  });
});

export const layer = Layer.effect(Agreements, make);
