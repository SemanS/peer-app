import { PEER_DIGEST_PLUGIN, DigestRpcGroup, PEER_DIGEST_METHODS } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { usage, bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerLog } from "../../core/log/PeerLog.ts";
import { hubDigest } from "./hubDigest.ts";
import { digestGet } from "./rpc.ts";
import { validSince, makeCatchup } from "./catchup.ts";
export const DigestPlugin = bindPlugin({
  ...PEER_DIGEST_PLUGIN,
  id: "digest",
  commandNames: ["catchup"],
  layer: Layer.empty,
  make: Effect.gen(function* () {
    const hub = yield* PeerHubClient,
      state = yield* PeerState,
      clock = yield* Clock.Clock,
      log = yield* PeerLog;
    const get = digestGet(
      (workspace, project) =>
        state
          .current()
          .persisted.workspaces.some(
            (w) => w.slug === workspace && w.manifest?.projects.some((p) => p.id === project),
          ),
      hubDigest(hub),
    );
    const catchup = makeCatchup({
      fetchDigest: get,
      email: () => state.current().persisted.email,
      nameOf: (email) =>
        state
          .current()
          .persisted.workspaces.flatMap((w) => w.manifest?.projects.flatMap((p) => p.members) ?? [])
          .find((m) => m.email === email)?.name ?? email,
      now: () => clock.currentTimeMillisUnsafe(),
      log: (fields) => log.record("catchup", fields),
    });
    return {
      agentTools: [
        {
          name: "peer_catchup",
          description:
            "Read what this project's team changed since a window; later calls show only new facts.",
          command: "catchup",
          inputSchema: {
            type: "object",
            properties: { since: { type: "string", maxLength: 64 } },
            additionalProperties: false,
          },
          arguments: (args) => {
            if (
              Object.keys(args).some((k) => k !== "since") ||
              (args.since !== undefined &&
                (typeof args.since !== "string" ||
                  args.since.length > 64 ||
                  !validSince(args.since)))
            )
              throw usage(
                "Invalid catchup window",
                "use an optional duration such as 8h or an RFC3339 timestamp.",
              );
            return typeof args.since === "string" ? ["--since", args.since] : [];
          },
        },
      ],
      commands: [
        {
          name: "catchup",
          usage: "catchup [--since 8h]",
          summary: "what the team did while you were away; later calls say only what is new",
          run: ({ session, args }) => catchup.run(session, args),
        },
      ],
      rpc: {
        group: DigestRpcGroup,
        handlers: (wrap) =>
          DigestRpcGroup.of({
            [PEER_DIGEST_METHODS.peerDigestGet]: (input) =>
              wrap.effect(PEER_DIGEST_METHODS.peerDigestGet, get(input)),
          }),
      },
      turnOff: Effect.sync(catchup.forget),
      workspaceCleanup: () => Effect.sync(catchup.forget),
    } satisfies PeerContributions;
  }),
});
