/**
 * What the plugin offers beyond its hooks, each a thin transport over its service: the RPC methods
 * the apps call.
 *
 * @module peerHub/plugins/ownership/client/transport
 */
import { OwnershipRpcGroup, PEER_OWNERSHIP_METHODS as methods } from "@t3tools/contracts";

import type { PeerContributions } from "../../../core/plugin.ts";
import type { Ownership } from "../Ownership.ts";

export const ownershipRpc = (owned: Ownership["Service"]) =>
  ({
    group: OwnershipRpcGroup,
    handlers: (wrap) =>
      OwnershipRpcGroup.of({
        [methods.peerOwnershipList]: (input) =>
          wrap.effect(methods.peerOwnershipList, owned.list(input)),
        [methods.peerOwnershipSetTaskOwner]: (input) =>
          wrap.effect(methods.peerOwnershipSetTaskOwner, owned.setTaskOwner(input)),
        [methods.peerOwnershipSetMap]: (input) =>
          wrap.effect(methods.peerOwnershipSetMap, owned.setMap(input)),
        [methods.peerOwnershipDecide]: (input) =>
          wrap.effect(methods.peerOwnershipDecide, owned.decide(input)),
        [methods.peerOwnershipWithdraw]: (input) =>
          wrap.effect(methods.peerOwnershipWithdraw, owned.withdraw(input)),
      }),
  }) satisfies NonNullable<PeerContributions["rpc"]>;
