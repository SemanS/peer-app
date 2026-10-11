/**
 * Settings on this environment: the Hub's settings feature on the signed-in session, and what the
 * status says of it without a request. Each workspace's visible settings are kept in memory and
 * read again when the Hub pings `settings`, when it pings `settings.proposal` (the pending count
 * the person decides), after a sync, after every write here and, for a missed ping, every five
 * minutes. The status carries each workspace's revision and pending counts (the proposals the
 * person decides, and their own), so a client reads the view and the proposals again when they change.
 *
 * @module peerHub/plugins/settings/service
 */
import type {
  PeerHubError,
  PeerSettingsGetInput,
  PeerSettingsStatus,
  PeerSettingsView,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { settingsHub, type SettingsHub } from "./hub.ts";

export class PeerSettings extends Context.Service<
  PeerSettings,
  Omit<SettingsHub, "view"> & {
    /** A workspace's visible settings, read from the Hub now (and kept for the status). */
    readonly view: (workspace: string) => Effect.Effect<PeerSettingsView, PeerHubError>;
    /** `view` as a client asks for it; its `revision` only tells the query from an older one. */
    readonly get: (input: PeerSettingsGetInput) => Effect.Effect<PeerSettingsView, PeerHubError>;
    /** The status slice: counts and ids only. */
    readonly status: Effect.Effect<PeerSettingsStatus>;
    /** Reads a workspace soon; a burst of these reads it once. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** Asks for every workspace to be read again. */
    readonly queueAll: Effect.Effect<void>;
    /** Reads now, then as things change, until interrupted. */
    readonly follow: Effect.Effect<never>;
    /** Forgets everything kept, or all but these workspaces. */
    readonly forget: Effect.Effect<void>;
    readonly keepOnly: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/settings/service/PeerSettings") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const hub = settingsHub(yield* PeerHubClient.PeerHubClient);
  /** Workspace → its visible settings, and how many pending proposals its person decides and made. */
  const views = yield* Ref.make<ReadonlyMap<string, PeerSettingsView>>(new Map());
  const waiting = yield* Ref.make<ReadonlyMap<string, readonly [deciding: number, own: number]>>(
    new Map(),
  );
  const changed = yield* Queue.unbounded<string>();
  /** A read that began before `forget` must not bring back what was forgotten. */
  let generation = 0;

  const view: PeerSettings["Service"]["view"] = (workspace) =>
    Effect.gen(function* () {
      const before = generation;
      const read = yield* hub.view(workspace);
      if (before === generation) {
        const kept = (yield* Ref.get(views)).get(workspace);
        yield* Ref.update(views, (all) => new Map(all).set(workspace, read));
        if (kept?.revision.seq !== read.revision.seq) yield* status.publish;
      }
      return read;
    });
  const readProposals = (workspace: string) =>
    Effect.gen(function* () {
      const before = generation;
      const { proposals } = yield* hub.proposals({ workspace, state: "pending" });
      const counts = [
        proposals.filter((proposal) => proposal.canDecide).length,
        proposals.filter((proposal) => proposal.mine).length,
      ] as const;
      if (before === generation) {
        yield* Ref.update(waiting, (all) => new Map(all).set(workspace, counts));
      }
    });
  /** A read in the background: one the Hub does not answer leaves what was read before. */
  const read = (workspace: string) =>
    Effect.all(
      [view(workspace).pipe(Effect.ignore), readProposals(workspace).pipe(Effect.ignore)],
      {
        concurrency: "unbounded",
        discard: true,
      },
    );
  const refresh = (workspace: string) =>
    read(workspace).pipe(Effect.andThen(status.publish), Effect.asVoid);

  const keepOnly: PeerSettings["Service"]["keepOnly"] = (workspaces) => {
    const keep = new Set(workspaces);
    const only = <A>(all: ReadonlyMap<string, A>) =>
      new Map([...all].filter(([workspace]) => keep.has(workspace)));
    return Ref.update(views, only).pipe(Effect.andThen(Ref.update(waiting, only)));
  };
  const slugs = Effect.map(state.workspaces, (workspaces) => workspaces.map(({ slug }) => slug));
  const readAll = Effect.gen(function* () {
    const workspaces = yield* slugs;
    yield* Effect.forEach(workspaces, read, { discard: true });
    yield* keepOnly(workspaces);
  });

  const follow: PeerSettings["Service"]["follow"] = Effect.gen(function* () {
    yield* readAll;
    yield* status.publish;
    while (true) {
      const woken = yield* Queue.take(changed).pipe(Effect.timeoutOption("5 minutes"));
      if (Option.isNone(woken)) yield* readAll;
      else {
        // A burst of pings is read once.
        yield* Effect.sleep("300 millis");
        const workspaces = new Set([woken.value, ...(yield* Queue.clear(changed))]);
        yield* Effect.forEach(workspaces, read, { discard: true });
      }
      yield* status.publish;
    }
  });

  /**
   * What a write leaves behind once it took effect: the settings and proposals as they are now. A
   * dry run, or a change the Hub refused as a result (a conflict, a path, a diagnostic), took none.
   */
  const written =
    (workspace: string) =>
    <A extends object, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.tap((result) =>
          !("kind" in result) || result.kind === "saved" || result.kind === "proposed"
            ? refresh(workspace)
            : Effect.void,
        ),
      );

  return PeerSettings.of({
    ...hub,
    view,
    get: (input) => view(input.workspace),
    status: Effect.gen(function* () {
      const counts = yield* Ref.get(waiting);
      return {
        workspaces: [...(yield* Ref.get(views))]
          .map(([workspace, { revision }]) => ({
            workspace,
            revision: revision.seq,
            pendingProposals: counts.get(workspace)?.[0] ?? 0,
            ownProposals: counts.get(workspace)?.[1] ?? 0,
          }))
          .sort((a, b) => a.workspace.localeCompare(b.workspace)),
      };
    }),
    readSoon: (workspace) => Queue.offer(changed, workspace).pipe(Effect.asVoid),
    queueAll: Effect.flatMap(slugs, (workspaces) =>
      Effect.forEach(workspaces, (workspace) => Queue.offer(changed, workspace), { discard: true }),
    ),
    follow,
    forget: Effect.gen(function* () {
      generation++;
      yield* Ref.set(views, new Map());
      yield* Ref.set(waiting, new Map());
      yield* Queue.clear(changed);
    }),
    keepOnly,
    save: (input) => hub.save(input).pipe(written(input.workspace)),
    revert: (input) => hub.revert(input).pipe(written(input.workspace)),
    importYaml: (input) => hub.importYaml(input).pipe(written(input.workspace)),
    applyProposal: (input) => hub.applyProposal(input).pipe(written(input.workspace)),
    githubEnable: (input) => hub.githubEnable(input).pipe(written(input.workspace)),
    githubDisable: (input) => hub.githubDisable(input).pipe(written(input.workspace)),
    propose: (input) => hub.propose(input).pipe(written(input.workspace)),
    declineProposal: (input) => hub.declineProposal(input).pipe(written(input.workspace)),
    withdrawProposal: (input) => hub.withdrawProposal(input).pipe(written(input.workspace)),
  });
});

export const layer = Layer.effect(PeerSettings, make);
