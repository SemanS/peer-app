/**
 * What the plugin offers the apps: its RPC methods, each a thin transport over its service. Agents
 * read acceptance in `peer status`; no agent command or tool gives or withdraws one.
 *
 * @module peerHub/plugins/acceptance/client/transport
 */
import { PEER_ACCEPTANCE_METHODS as methods, AcceptanceRpcGroup } from "@t3tools/contracts";

import type { PeerContributions } from "../../../core/plugin.ts";
import type { Acceptance } from "../Acceptance.ts";

export const acceptanceRpc = (acceptance: Acceptance["Service"]) =>
  ({
    group: AcceptanceRpcGroup,
    handlers: (wrap) =>
      AcceptanceRpcGroup.of({
        [methods.peerAcceptanceView]: (input) =>
          wrap.effect(methods.peerAcceptanceView, acceptance.view(input)),
        [methods.peerAcceptanceAccept]: (input) =>
          wrap.effect(methods.peerAcceptanceAccept, acceptance.accept(input)),
        [methods.peerAcceptanceWithdraw]: (input) =>
          wrap.effect(methods.peerAcceptanceWithdraw, acceptance.withdraw(input)),
        [methods.peerAcceptanceReviewPolicy]: (input) =>
          wrap.effect(methods.peerAcceptanceReviewPolicy, acceptance.reviewPolicy(input)),
        [methods.peerAcceptanceSetReviewPolicy]: (input) =>
          wrap.effect(methods.peerAcceptanceSetReviewPolicy, acceptance.setReviewPolicy(input)),
      }),
  }) satisfies NonNullable<PeerContributions["rpc"]>;
