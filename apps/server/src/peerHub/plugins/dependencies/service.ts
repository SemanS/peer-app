import {
  PeerHubError,
  type PeerDependencyChangeInput,
  type PeerDependencyChangeResult,
  type PeerDependencySnapshot,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { hubClient } from "./hubClient.ts";
import { Snapshots } from "./snapshot.ts";
import { facts, type Fact } from "./facts.ts";
import { baseline, handoffText, ledger, startText, stepText } from "./text.ts";
export class Dependencies extends Context.Service<
  Dependencies,
  {
    readonly snapshot: Effect.Effect<ReadonlyArray<PeerDependencySnapshot>>;
    readonly refresh: (workspace?: string) => Effect.Effect<void>;
    readonly ping: (workspace: string, change: string) => Effect.Effect<void>;
    readonly cleanup: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly change: (
      input: PeerDependencyChangeInput,
    ) => Effect.Effect<PeerDependencyChangeResult, PeerHubError>;
    readonly facts: (session: PeerSessionView) => Effect.Effect<{ on: Fact[]; needed: Fact[] }>;
    readonly hook: (session: PeerSessionView, start: boolean) => Effect.Effect<string | null>;
    readonly acknowledge: (session: PeerSessionView) => Effect.Effect<void>;
    readonly handoff: (session: PeerSessionView) => Effect.Effect<string | null>;
    readonly reset: Effect.Effect<void>;
    readonly run: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peerHub/plugins/dependencies/service/Dependencies") {}
const make = Effect.gen(function* () {
  const hub = hubClient(yield* PeerHubClient.PeerHubClient),
    state = yield* PeerState.PeerState,
    published = yield* PeerStatus.PeerStatus,
    work = yield* PeerWork.PeerWork,
    agents = yield* PeerAgents.PeerAgents;
  const cache = new Snapshots(),
    pending = new Set<string>(),
    queue = yield* Queue.unbounded<string>();
  let epoch = 0;
  const refresh = (workspace?: string) =>
    Effect.gen(function* () {
      for (const ws of (yield* state.read).persisted.workspaces.filter(
        (ws) => !workspace || ws.slug === workspace,
      )) {
        const now = yield* Clock.currentTimeMillis;
        if (!cache.due(ws.slug, now)) continue;
        yield* hub.read(ws.slug).pipe(
          Effect.flatMap((value) => (cache.put(value, now) ? published.publish : Effect.void)),
          Effect.ignore,
        );
      }
    });
  const getFacts = (session: PeerSessionView) =>
    Effect.gen(function* () {
      const view = (yield* agents.hubViews).find((v) => v.workspace === session.workspace)?.view;
      return facts(
        cache.values.get(session.workspace),
        session.project,
        session.task ?? "",
        yield* work.tasks(session.workspace, session.project),
        yield* work.threads(session.workspace, session.project),
        view?.contexts ?? [],
      );
    });
  const hook = (session: PeerSessionView, start: boolean) =>
    Effect.gen(function* () {
      const own = yield* state.read;
      if (own.persisted.coordination?.enabled === false || !session.task) return null;
      const { on, needed } = yield* getFacts(session);
      if (!cache.values.get(session.workspace)?.available) return null;
      const memory = session.local("dependencies", () => ledger(epoch));
      const now = yield* Clock.currentTimeMillis;
      let text: string | null;
      if (start || memory.epoch !== epoch || !memory.ready) {
        memory.epoch = epoch;
        baseline(memory, on, now);
        text = startText(on, needed);
      } else
        text = stepText(
          memory,
          on,
          now,
          session.contextReadVersion ?? (() => undefined),
          session.tellIndex ?? (() => {}),
        );
      if (text)
        yield* agents.log("dependencies.told", {
          session: session.id,
          kind: start ? "start" : "step",
          chars: text.length,
          scopes: on.map((f) => f.id),
        });
      return text;
    });
  return Dependencies.of({
    snapshot: Effect.sync(() => [...cache.values.values()]),
    refresh,
    cleanup: (workspaces) => Effect.sync(() => cache.clean(workspaces)),
    reset: Effect.sync(() => {
      epoch++;
      cache.restart();
    }),
    facts: getFacts,
    hook,
    acknowledge: (session) =>
      Effect.gen(function* () {
        const { on } = yield* getFacts(session);
        const memory = session.local("dependencies", () => ledger(epoch));
        memory.epoch = epoch;
        baseline(memory, on, yield* Clock.currentTimeMillis);
      }),
    handoff: (session) => getFacts(session).pipe(Effect.map(({ on }) => handoffText(on))),
    ping: (workspace, change) => {
      if (change === "work" && !cache.hasEdges(workspace)) return Effect.void;
      pending.add(workspace);
      return Queue.offer(queue, workspace).pipe(Effect.asVoid);
    },
    change: (input) =>
      hub.change(input).pipe(
        Effect.tap((answer) =>
          Effect.gen(function* () {
            if (answer.kind !== "changed") return;
            const now = yield* Clock.currentTimeMillis;
            if (cache.apply(input.workspace, input.projectId, input.taskId, answer.dependsOn, now))
              yield* published.publish;
          }),
        ),
      ),
    run: Effect.forever(
      Effect.gen(function* () {
        yield* Queue.take(queue);
        yield* Effect.sleep("300 millis");
        yield* Queue.clear(queue);
        const workspaces = [...pending];
        pending.clear();
        for (const workspace of workspaces) yield* refresh(workspace);
      }),
    ),
  });
});
export const layer = Layer.effect(Dependencies, make);
