/**
 * What the plugin offers beyond its hooks, each a thin transport over its service: the RPC methods
 * the apps call, and the MCP tool for agents that have no shell (their `peer owner`).
 *
 * @module peerHub/plugins/ownership/client/transport
 */
import { OwnershipRpcGroup, PEER_OWNERSHIP_METHODS as methods } from "@t3tools/contracts";

import { usage, type PeerContributions } from "../../../core/plugin.ts";
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

export const ownerTools = [
  {
    name: "peer_owner",
    description:
      "Who owns your task and paths; ask the owner of a path where they decide (action ask, paths, why); withdraw a call (action withdraw, id).",
    command: "owner",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["show", "ask", "withdraw"] },
        paths: { type: "array", items: { type: "string" } },
        why: { type: "string" },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
    arguments: (input) => {
      const action = input.action ?? "show";
      if (action === "show") return [];
      if (action === "withdraw" && typeof input.id === "string") return ["withdraw", input.id];
      if (action === "ask" && typeof input.why === "string" && Array.isArray(input.paths))
        return ["ask", ...input.paths.map(String), input.why];
      throw usage(
        "Invalid owner action.",
        "use show, ask with paths and why, or withdraw with an id.",
      );
    },
  },
] satisfies NonNullable<PeerContributions["agentTools"]>;
