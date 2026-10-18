/**
 * The changes plugin: each computer reports the Jujutsu changes of its agents (facts, never code) to
 * the Hub's `changes` feature, and everyone's changes in flight come back as one project view, a
 * `peer changes` index for agents and the review marks of this person. It is active while the
 * signed-in Hub serves that feature; in a Git checkout it reports nothing.
 *
 * @module peerHub/plugins/changes
 */
import { ChangesRpcGroup, PEER_CHANGES_METHODS, PEER_CHANGES_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Changes from "./Changes.ts";
import { changesCommand } from "./cli.ts";

export const ChangesPlugin = bindPlugin({
  ...PEER_CHANGES_PLUGIN,
  id: "changes",
  commandNames: ["changes"],
  layer: Changes.layer,
  make: Effect.gen(function* () {
    const changes = yield* Changes.Changes;
    return {
      commands: [changesCommand(changes)],
      hooks: {
        sessionStart: changes.started,
        postTool: ({ session }) => changes.touch(session, false).pipe(Effect.as(null)),
        stop: ({ session }) => changes.touch(session, true),
        sessionEnd: ({ session }) => changes.ended(session),
      },
      hubChanges: {
        changes: ["changes", "resync"],
        ownEcho: true,
        onPing: (ping) =>
          ping.change === "resync"
            ? changes.readSoon(ping.workspace).pipe(Effect.andThen(changes.flush))
            : changes.readSoon(ping.workspace),
      },
      lifecycle: (event) =>
        event.kind === "synced"
          ? Effect.forEach(event.workspaces, (workspace) => changes.readSoon(workspace.slug), {
              discard: true,
            })
          : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? changes.forget()
          : event.kind === "left-workspace"
            ? changes.forget(event.workspace)
            : changes.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: changes.status },
      rpc: {
        group: ChangesRpcGroup,
        handlers: (wrap) =>
          ChangesRpcGroup.of({
            [PEER_CHANGES_METHODS.peerChangesSubscribe]: (place) =>
              wrap.stream(PEER_CHANGES_METHODS.peerChangesSubscribe, changes.watch(place)),
            [PEER_CHANGES_METHODS.peerChangesMarkReviewed]: (input) =>
              wrap.effect(
                PEER_CHANGES_METHODS.peerChangesMarkReviewed,
                changes.markReviewed(input),
              ),
            [PEER_CHANGES_METHODS.peerChangesReviewDiff]: (input) =>
              wrap.effect(PEER_CHANGES_METHODS.peerChangesReviewDiff, changes.reviewDiff(input)),
          }),
      },
      turnOff: changes.withdrawAll,
      run: changes.run,
    } satisfies PeerContributions;
  }),
});
