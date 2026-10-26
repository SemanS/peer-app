import { PEER_OPENSPEC_METHODS, PEER_OPENSPEC_PLUGIN, OpenSpecRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import { briefCommand, briefTools } from "./brief.ts";
import * as OpenSpec from "./OpenSpec.ts";

export const OpenSpecPlugin = bindPlugin({
  ...PEER_OPENSPEC_PLUGIN,
  id: "openspec",
  commandNames: ["brief"],
  layer: OpenSpec.layer,
  make: Effect.gen(function* () {
    const service = yield* OpenSpec.OpenSpec;
    const services = { openspec: service, work: yield* PeerWork, state: yield* PeerState };
    return {
      commands: [briefCommand(services)],
      agentTools: briefTools,
      rpc: {
        group: OpenSpecRpcGroup,
        handlers: (wrap) =>
          OpenSpecRpcGroup.of({
            [PEER_OPENSPEC_METHODS.peerOpenSpecRead]: (input) =>
              wrap.effect(PEER_OPENSPEC_METHODS.peerOpenSpecRead, service.read(input)),
            [PEER_OPENSPEC_METHODS.peerOpenSpecLink]: (input) =>
              wrap.effect(PEER_OPENSPEC_METHODS.peerOpenSpecLink, service.link(input)),
            [PEER_OPENSPEC_METHODS.peerOpenSpecUnlink]: (input) =>
              wrap.effect(PEER_OPENSPEC_METHODS.peerOpenSpecUnlink, service.unlink(input)),
            [PEER_OPENSPEC_METHODS.peerOpenSpecSaveBrief]: (input) =>
              wrap.effect(PEER_OPENSPEC_METHODS.peerOpenSpecSaveBrief, service.saveBrief(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});
