import {
  PEER_RESOURCES_PLUGIN,
  PEER_RESOURCES_METHODS,
  ResourcesRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerResources, layer } from "./service.ts";
export const ResourcesPlugin = bindPlugin({
  ...PEER_RESOURCES_PLUGIN,
  id: "resources",
  layer,
  make: Effect.gen(function* () {
    const service = yield* PeerResources,
      state = yield* PeerState;
    return {
      claimScheme: {
        prefix: "resource:",
        flags: ["--ttl"],
        help: [
          'claim resource:<name> [--ttl 30m] [--intent "<why>"]  hold a resource for 1 minute to 8 hours',
          'release resource:<name>|"<pattern>"  let go of a leased scope; no args drops all your holds',
        ],
        validate: service.validate,
        recognizesRelease: service.canRelease,
        run: service.command,
      },
      fallbackPolicy: service.policyFor,
      statusBlock: service.block,
      intentResult: service.intentResult,
      hooks: {
        sessionStart: service.start,
        notices: [{ wakes: false, read: service.step }],
      },
      hubChanges: {
        changes: ["resources", "projects"],
        onPing: (ping) => service.queue(ping.workspace),
      },
      status: { read: Effect.sync(service.status) },
      rpc: {
        group: ResourcesRpcGroup,
        handlers: (wrap) =>
          ResourcesRpcGroup.of({
            [PEER_RESOURCES_METHODS.peerResourcesRelease]: (input) =>
              wrap.effect(
                PEER_RESOURCES_METHODS.peerResourcesRelease,
                service.releasePerson(input),
              ),
          }),
      },
      workspaceCleanup: (event) =>
        service.cleanup(
          event.kind === "signing-out"
            ? []
            : event.kind === "synced"
              ? event.workspaces.map((w) => w.slug)
              : state
                  .current()
                  .persisted.workspaces.filter((w) => w.slug !== event.workspace)
                  .map((w) => w.slug),
        ),
      lifecycle: () =>
        Effect.gen(function* () {
          const workspaces = state.current().persisted.workspaces;
          yield* service.cleanup(workspaces.map((w) => w.slug));
          for (const workspace of workspaces) yield* service.queue(workspace.slug);
        }),
      run: service.run,
      turnOff: service.cleanup([]),
    } satisfies PeerContributions;
  }),
});
