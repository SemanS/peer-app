import {
  PeerHubError,
  type PeerPlansPlace,
  type PeerPlansStatus,
  type PeerPlansView,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import type { PeerHookContext, PeerSessionView, PeerToolContext } from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import type { PlansCommands } from "./cli.ts";
import { createCodeGraph, type CodeGraph } from "./client/codegraph.ts";
import { OLDER, SILENT, STALE, bodyOf, createOutbox, plansHub } from "./client/hub.ts";
import { mark, naming, untold, type Reader } from "./client/relations.ts";
import { resolveItems } from "./client/resolve.ts";
import { createViews, inPlace } from "./client/views.ts";
import { memory, toldOf } from "./tell.ts";
import { PLAN_MODE_LINE, statusLine, stepText, type Voice } from "./text.ts";

/** `PEER_PLANS=off` keeps plans off on this computer, whatever its owner chose in Settings. */
export const forcedOff = () => process.env.PEER_PLANS === "off";

export class Plans extends Context.Service<
  Plans,
  {
    /** What `peer plan` asks of the plugin. */
    readonly commands: PlansCommands;
    readonly status: Effect.Effect<PeerPlansStatus>;
    /** The plans and relations of a place, read from the Hub now. */
    readonly list: (place: PeerPlansPlace) => Effect.Effect<PeerPlansView, PeerHubError>;
    /** The Hub said plans changed in a workspace: its view is read within a second. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** Forgets a workspace, or every one: what was read of it and the declarations waiting for it. */
    readonly forget: (workspace?: string) => Effect.Effect<void>;
    /** What a session hears of relations at a step: the ones it was not told of, three at most. */
    readonly notice: (ctx: PeerHookContext | PeerToolContext) => Effect.Effect<string | null>;
    /** The one line an agent with the Peer Mod hears on leaving plan mode without a plan. */
    readonly planMode: (ctx: PeerToolContext) => Effect.Effect<string | null>;
    /** The line `peer status` shows of the session's plan, from what was last read. */
    readonly statusBlock: (session: PeerSessionView) => Effect.Effect<string | null>;
    /** A session starts: after a compaction it hears its open relations once more. */
    readonly started: (ctx: PeerHookContext) => Effect.Effect<null>;
    /** A session ends: its plan and any declaration still waiting end with it. */
    readonly ended: (session: PeerSessionView) => Effect.Effect<void>;
    /** Withdraws every plan of this computer: what the owner turning plans off asks. */
    readonly turnOff: Effect.Effect<void, PeerHubError>;
    /** One pass of the background work: due declarations go again, views the Hub said changed are read. */
    readonly tick: Effect.Effect<void>;
    /** `tick` each second, publishing the status when it moved, until interrupted. */
    readonly run: (publish: Effect.Effect<unknown>) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/plans/Plans") {}

export function makePlans(
  state: PeerState["Service"],
  agents: PeerAgents["Service"],
  work: PeerWork["Service"],
  hub: ReturnType<typeof plansHub>,
  graph: CodeGraph,
) {
  return Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const environment: string = state.environmentId;
    const views = createViews(forcedOff);
    const outbox = createOutbox();
    const reads = new Set<string>();
    let epoch = 0;

    const reader = (session: PeerSessionView): Reader => ({
      session: session.id,
      email: state.current().persisted.email ?? "",
      environment,
    });
    const own = (session: PeerSessionView, plan: PeerPlansView["plans"][number]) =>
      plan.project === session.project &&
      plan.session === session.id &&
      plan.environment === environment;
    const voice = (session: PeerSessionView) =>
      Effect.gen(function* () {
        const tasks = yield* work.tasks(session.workspace, session.project);
        return {
          reader: reader(session),
          person: (email) => state.nameOf(session.workspace, email),
          task: (id) => tasks.find((task) => task.id === id)?.key,
          now: yield* Clock.currentTimeMillis,
        } satisfies Voice;
      });

    /** What the Hub says of a workspace's plans now; null for a Hub without plans. */
    const read = (workspace: string) =>
      Effect.gen(function* () {
        const fence = epoch;
        const now = yield* Clock.currentTimeMillis;
        const view = yield* hub.view(workspace);
        if (fence === epoch) views.keep(workspace, view, now);
        return view;
      });
    const readable = (workspace: string) =>
      read(workspace).pipe(
        Effect.filterOrFail(
          (view): view is PeerPlansView => view !== null,
          () => new PeerHubError({ detail: "plans need a newer Peer Hub", refused: true }),
        ),
      );

    const declare: PlansCommands["declare"] = (session, input) =>
      Effect.gen(function* () {
        // The Hub should know the session before its plan, so the answer already holds relations.
        yield* agents.sync(session.workspace, 2_000);
        const now = yield* Clock.currentTimeMillis;
        const { items, notes } = yield* Effect.promise(() =>
          resolveItems(graph, session.root, input.items, () => clock.currentTimeMillisUnsafe()),
        );
        const { seq, declaration } = outbox.prepare(session.id, now, { mode: input.mode, items });
        const body = bodyOf(environment, session.id, seq, declaration);
        const answer = yield* hub
          .declare(session.workspace, session.project, body)
          .pipe(Effect.result);
        if (answer._tag === "Failure") {
          // A refusal says the declaration is wrong; no answer says nothing, so it is sent again.
          if (answer.failure.refused === true) return yield* answer.failure;
          const { workspace, project } = session;
          outbox.hold(session.id, { ...declaration, workspace, project, seq }, now);
          memory(session).declared = true;
          return yield* Effect.fail(SILENT);
        }
        const result = answer.success;
        if (result._tag === "unsupported") {
          views.unsupported(now);
          return yield* Effect.fail(OLDER);
        }
        outbox.drop(session.id);
        if (result._tag === "stale") return yield* Effect.fail(STALE);
        reads.add(session.workspace);
        memory(session).declared = true;
        const { plan, changed, relations } = result.declared;
        const told = toldOf(session);
        const listed = changed && session.adapter !== "mcp" ? untold(told, relations) : relations;
        mark(told, listed);
        return {
          plan,
          changed,
          mode: input.mode,
          named: items,
          relations: listed,
          total: relations.length,
          notes,
          voice: yield* voice(session),
        };
      });

    const show: PlansCommands["show"] = (session) =>
      Effect.gen(function* () {
        const view = yield* readable(session.workspace);
        const named = naming(view, reader(session), session.project);
        const told = toldOf(session);
        const listed = session.adapter === "mcp" ? named : untold(told, named);
        mark(told, listed);
        return {
          plan: view.plans.find((plan) => own(session, plan)),
          relations: listed,
          total: named.length,
          voice: yield* voice(session),
        };
      });

    const withdraw: PlansCommands["withdraw"] = (session) =>
      Effect.gen(function* () {
        const waiting = outbox.drop(session.id);
        const answer = yield* hub.withdraw(session.workspace, { environment, session: session.id });
        memory(session).declared = false;
        reads.add(session.workspace);
        yield* agents.log("plans.withdrawn", {
          session: session.id,
          count: answer?.withdrawn ?? 0,
        });
        return { ended: (answer?.withdrawn ?? 0) + (waiting ? 1 : 0) };
      });

    const publicView: PlansCommands["publicView"] = (session) =>
      Effect.gen(function* () {
        const view = yield* readable(session.workspace);
        return {
          project: session.project,
          plans: view.plans.filter((plan) => plan.project === session.project && plan.live),
          voice: yield* voice(session),
        };
      });

    const list = (place: PeerPlansPlace) =>
      Effect.gen(function* () {
        if (!(yield* state.workspaces).some((w) => w.slug === place.workspace))
          return yield* new PeerHubError({
            detail: "That workspace is not available here.",
            refused: true,
          });
        return inPlace(yield* readable(place.workspace), place);
      });

    const tick = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const live = new Set((yield* agents.sessions).map((session) => session.id));
      for (const [id, waiting] of outbox.due(now, live)) {
        const fence = epoch;
        const body = bodyOf(environment, id, waiting.seq, waiting);
        const sent = yield* hub
          .declare(waiting.workspace, waiting.project, body)
          .pipe(Effect.result);
        if (fence !== epoch) return;
        const failed = sent._tag === "Failure" && sent.failure.refused !== true;
        const answer = sent._tag === "Success" ? sent.success._tag : "refused";
        if (failed) outbox.later(id, waiting, now);
        else {
          // Recorded, refused, or a newer plan is there: either way nothing is left to send.
          outbox.drop(id);
          if (answer === "recorded") reads.add(waiting.workspace);
        }
        const outcome = failed ? "failed" : answer === "recorded" ? "sent" : answer;
        yield* agents.log("plans.resent", { session: id, outcome });
      }
      for (const workspace of reads) {
        reads.delete(workspace);
        if (views.askable(now)) yield* read(workspace).pipe(Effect.ignore);
      }
    });

    const notice: Plans["Service"]["notice"] = (ctx) =>
      Effect.gen(function* () {
        const { session } = ctx;
        if (ctx.waking || session.adapter === "mcp" || !["claude", "codex"].includes(session.agent))
          return null;
        const told = toldOf(session);
        const named = naming(views.get(session.workspace), reader(session), session.project);
        const fresh = untold(told, named);
        if (fresh.length === 0) return null;
        const { heard, text } = stepText(fresh, yield* voice(session));
        mark(told, heard);
        if (text !== null)
          yield* agents.log("plans.told", {
            session: session.id,
            relations: heard.length,
            chars: text.length,
          });
        return text;
      });

    const planMode: Plans["Service"]["planMode"] = ({ session, tool }) =>
      Effect.gen(function* () {
        const mine = memory(session);
        const planned =
          mine.declared || views.get(session.workspace)?.plans.some((p) => own(session, p));
        if (tool !== "ExitPlanMode" || session.adapter !== "mod" || mine.nudged || planned)
          return null;
        mine.nudged = true;
        yield* agents.log("plans.nudged", { session: session.id, where: "plan-mode" });
        return PLAN_MODE_LINE;
      });

    const statusBlock: Plans["Service"]["statusBlock"] = (session) =>
      Effect.sync(() => {
        const view = views.get(session.workspace);
        const mine = view?.plans.find((plan) => own(session, plan));
        // Nothing is known of the plan before the Hub's view is read, or while a declaration waits.
        if (view === undefined || (mine === undefined && memory(session).declared)) return null;
        return statusLine(mine, naming(view, reader(session), session.project).length);
      });

    const started: Plans["Service"]["started"] = ({ session, source }) =>
      Effect.gen(function* () {
        if (source === "compact") toldOf(session).clear();
        yield* agents.log("plans.nudged", { session: session.id, where: "start" });
        return null;
      });

    const ended: Plans["Service"]["ended"] = (session) =>
      Effect.gen(function* () {
        const waiting = outbox.drop(session.id);
        const planned = views.get(session.workspace)?.plans.some((p) => own(session, p));
        if (waiting || planned || memory(session).declared)
          yield* hub
            .withdraw(session.workspace, { environment, session: session.id })
            .pipe(Effect.ignore);
      });

    const forget = (workspace?: string) =>
      Effect.sync(() => {
        epoch += 1;
        views.drop(workspace);
        outbox.purge(workspace);
        for (const slug of reads)
          if (workspace === undefined || slug === workspace) reads.delete(slug);
      });

    return Plans.of({
      commands: { declare, show, withdraw, publicView },
      status: Effect.sync(views.status),
      list,
      readSoon: (workspace) => Effect.sync(() => void reads.add(workspace)),
      forget,
      tick,
      notice,
      planMode,
      statusBlock,
      started,
      ended,
      turnOff: Effect.gen(function* () {
        const workspaces = (yield* state.workspaces).map((w) => w.slug);
        yield* forget();
        const failed: string[] = [];
        for (const slug of workspaces) {
          const ended = yield* hub.withdraw(slug, { environment }).pipe(Effect.result);
          if (ended._tag === "Failure") failed.push(slug);
        }
        if (failed.length > 0)
          return yield* new PeerHubError({
            detail: `Plans could not be withdrawn from ${failed.join(", ")}; they end with their sessions.`,
          });
      }),
      run: (publish) =>
        Effect.gen(function* () {
          for (const workspace of yield* state.workspaces) reads.add(workspace.slug);
          while (true) {
            const before = views.revision();
            yield* tick;
            if (before !== views.revision()) yield* publish;
            yield* Effect.sleep("1 second");
          }
        }),
    });
  });
}

export const layer = Layer.effect(
  Plans,
  Effect.gen(function* () {
    return yield* makePlans(
      yield* PeerState,
      yield* PeerAgents,
      yield* PeerWork,
      plansHub(yield* PeerHubClient),
      createCodeGraph(),
    );
  }),
);
